/** Lexical function facts. Calling a function and creating its value are separate operations. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Binding, Module, Reference, Resolved, WriteSite } from '.';
import { declaringRunner, isParameter, runnerOf } from '.';
import type { PropertyReads } from './members';

export type FunctionNode = Extract<Node, {
  type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression';
}>;

export type CallNode = Extract<Node, { type: 'CallExpression' | 'NewExpression' }>;

export interface FunctionSummary {
  readonly module: Module;
  readonly fn: FunctionNode;
  /** Captured values and parameters used by this invocation, excluding nested functions. */
  readonly reads: readonly Reference[];
  readonly writes: readonly WriteSite[];
  readonly calls: readonly CallNode[];
  /** `this` is supplied by the call site, so its roots need receiver analysis. */
  readonly usesReceiver: boolean;
  /** Potential mutations through `this`; call-site receiver mapping is still required. */
  readonly receiverWrites: readonly Node[];
  readonly opaque: boolean;
}

/** A summary while its module is scanned. */
interface SummaryDraft extends FunctionSummary {
  reads: Reference[];
  writes: WriteSite[];
  calls: CallNode[];
  usesReceiver: boolean;
  receiverWrites: Node[];
  opaque: boolean;
}

const FUNCTION_TYPES = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'] as const;

const BODY_TYPES = [
  'CallExpression', 'NewExpression', 'ThisExpression',
  'AssignmentExpression', 'UpdateExpression', 'UnaryExpression',
  'MemberExpression', 'AwaitExpression', 'YieldExpression', 'TaggedTemplateExpression',
] as const;

/** Follow immutable aliases and linked imports; changed function values remain opaque. */
export function functionValue(module: Module, value: Node, visited = new Set<Binding>()): FunctionNode | null {
  if (is.Function(value)) return value as FunctionNode;
  if ('expression' in value && (
    is.ParenthesizedExpression(value) || is.TSAsExpression(value)
    || is.TSNonNullExpression(value) || is.TSSatisfiesExpression(value)
  )) {
    return functionValue(module, value.expression as Node, visited);
  }
  if (!is.Identifier(value) && !is.JSXIdentifier(value)) return null;
  const binding = module.bindingOf(value);
  if (binding === null || visited.has(binding)) return null;
  visited.add(binding);
  if (binding.references.some((reference) => reference.isWrite)) return null;

  const definition = binding.definition()?.binding;
  if (definition != null && definition !== binding) {
    const name = definition.declarations[0];
    return name === undefined ? null : functionValue(definition.module, name, visited);
  }
  const declaration = binding.declarations[0];
  if (declaration === undefined) return null;
  const parent = binding.module.parentOf(declaration);
  if (is.Function(parent) && parent.id === declaration) return parent as FunctionNode;
  if (is.VariableDeclarator(parent) && parent.init !== null) {
    return functionValue(binding.module, parent.init, visited);
  }
  return null;
}

/**
 * One summary per function. Each module is scanned once and every node is
 * attributed to the function whose run executes it (`runnerOf`), so the cost
 * grows with the module, not with the module times its functions.
 */
export function summarizeFunctions(
  resolved: Resolved,
  properties: PropertyReads,
): ReadonlyMap<FunctionNode, FunctionSummary> {
  const summaries = new Map<Node, SummaryDraft>();

  /** The summary of the function that runs `node`; undefined for module code and field initializers. */
  function summaryOf(runner: Node | null): SummaryDraft | undefined {
    return runner === null ? undefined : summaries.get(runner);
  }

  for (const entry of resolved.modules) {
    const module = entry.module;
    for (const fn of module.findAll(FUNCTION_TYPES)) {
      summaries.set(fn, {
        module, fn, reads: [], writes: [], calls: [],
        usesReceiver: false, receiverWrites: [], opaque: false,
      });
    }

    for (const reference of module.references) {
      if (reference.inTypePosition || reference.isWrite) continue;
      const summary = summaryOf(runnerOf(module, reference.node));
      if (summary === undefined) continue;
      const binding = reference.binding;
      const captured = binding === null || isParameter(binding) || declaringRunner(module, binding) !== summary.fn;
      if (captured) summary.reads.push(reference);
    }

    for (const sites of entry.writes.values()) {
      for (const site of sites) summaryOf(site.runner)?.writes.push(site);
    }

    for (const node of module.findAll(BODY_TYPES)) {
      const summary = summaryOf(runnerOf(module, node));
      if (summary !== undefined) addBodyNode(summary, module, node, properties);
    }
  }
  return summaries as ReadonlyMap<FunctionNode, FunctionSummary>;
}

function addBodyNode(summary: SummaryDraft, module: Module, node: Node, properties: PropertyReads): void {
  if (is.CallExpression(node)) {
    summary.calls.push(node);
    if (receiverRoot(node.callee)) summary.receiverWrites.push(node);
  } else if (is.NewExpression(node)) {
    summary.calls.push(node);
  } else if (is.ThisExpression(node)) {
    summary.usesReceiver = true;
  } else if (is.AssignmentExpression(node)) {
    if (receiverRoot(node.left)) summary.receiverWrites.push(node);
  } else if (is.UpdateExpression(node)) {
    if (receiverRoot(node.argument)) summary.receiverWrites.push(node);
  } else if (is.UnaryExpression(node)) {
    if (node.operator === 'delete' && receiverRoot(node.argument)) summary.receiverWrites.push(node);
  } else if (is.MemberExpression(node)) {
    if (properties.mayRunCode(module, node)) summary.opaque = true;
  } else {
    // `await` and `yield` suspend; a tagged template calls an unknown tag.
    summary.opaque = true;
  }
}

function receiverRoot(node: Node): boolean {
  let root = node;
  while (is.MemberExpression(root)) root = root.object;
  return is.ThisExpression(root);
}
