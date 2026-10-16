/** Portable, non-executable initial DOM extraction for package components. */
import type * as t from '../ast/compiler-types';
import {
  childNode,
  childNodes,
  identifierLikeName,
  nodeField,
  unwrapTypeExpression,
  type BaseNode,
} from '../ast';
import { initialSite } from '../planning/initial-content';
import type { InitialRenderNode, InitialRenderPlan } from '../planning/initial-content';
import { planInitialDom, relativeInitialDom, type InitialDomRoot } from '../dom/initial-dom';
import { emitInitialHtml } from '../dom/initial-html';
import type {
  ExperimentalPackageRenderNode,
  ExperimentalPackageRenderPlan,
  ExperimentalPackageRenderValue,
} from './model';

function declarationFor(
  program: t.Program,
  local: string,
): BaseNode | undefined {
  for (const statement of program.body as unknown as BaseNode[]) {
    const declaration = statement.type.startsWith('Export')
      ? childNode(statement, 'declaration')
      : statement;
    if (
      declaration?.type === 'FunctionDeclaration' &&
      identifierLikeName(childNode(declaration, 'id')) === local
    ) {
      return declaration;
    }
  }
  return undefined;
}

function literalValue(node: BaseNode): ExperimentalPackageRenderValue | undefined {
  const value = nodeField(node, 'value');
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { kind: 'literal', value };
  }
  return undefined;
}

function propertyName(node: BaseNode | null): string | undefined {
  const identifier = identifierLikeName(node);
  if (identifier !== null) return identifier;
  const value = node && nodeField(node, 'value');
  return typeof value === 'string' ? value : undefined;
}

interface PropBindings {
  readonly direct: ReadonlyMap<string, string>;
  readonly object?: string;
}

function propBindings(component: BaseNode): PropBindings | undefined {
  const params = childNodes(component, 'params');
  if (params.length === 0) return { direct: new Map() };
  if (params.length !== 1) {
    const direct = new Map<string, string>();
    for (const parameter of params) {
      const target = parameter.type === 'AssignmentPattern'
        ? childNode(parameter, 'left')
        : parameter;
      const name = identifierLikeName(target);
      if (name === null || parameter.type === 'AssignmentPattern') return undefined;
      direct.set(name, name);
    }
    return { direct };
  }
  const parameter = params[0]!;
  if (parameter.type === 'AssignmentPattern') return undefined;
  const object = identifierLikeName(parameter);
  if (object !== null) return { direct: new Map(), object };
  if (parameter.type !== 'ObjectPattern') return undefined;
  const direct = new Map<string, string>();
  for (const property of childNodes(parameter, 'properties')) {
    if (
      !['Property', 'ObjectProperty'].includes(property.type) ||
      nodeField(property, 'computed') === true
    ) {
      return undefined;
    }
    const prop = propertyName(childNode(property, 'key'));
    const target = childNode(property, 'value');
    const local = identifierLikeName(target);
    if (prop === undefined || local === null || target?.type === 'AssignmentPattern') {
      return undefined;
    }
    direct.set(local, prop);
  }
  return { direct };
}

function renderValue(
  input: BaseNode,
  bindings: PropBindings,
  scalarProps: ReadonlySet<string>,
): ExperimentalPackageRenderValue | undefined {
  const node = unwrapTypeExpression(input);
  const direct = identifierLikeName(node);
  if (direct !== null) {
    const prop = bindings.direct.get(direct);
    return prop !== undefined && scalarProps.has(prop)
      ? { kind: 'prop', name: prop }
      : literalValue(node);
  }
  if (
    node.type === 'MemberExpression' &&
    bindings.object !== undefined &&
    identifierLikeName(childNode(node, 'object')) === bindings.object
  ) {
    const computed = nodeField(node, 'computed') === true;
    const property = childNode(node, 'property');
    const prop = computed
      ? (typeof nodeField(property!, 'value') === 'string'
          ? nodeField(property!, 'value') as string
          : undefined)
      : identifierLikeName(property) ?? undefined;
    return prop !== undefined && scalarProps.has(prop)
      ? { kind: 'prop', name: prop }
      : undefined;
  }
  return literalValue(node);
}

function jsxName(node: BaseNode): string | undefined {
  return identifierLikeName(childNode(childNode(node, 'openingElement')!, 'name')) ?? undefined;
}

function attributeName(node: BaseNode): string | undefined {
  return identifierLikeName(childNode(node, 'name')) ?? undefined;
}

function staticStringAttribute(node: BaseNode): string | undefined {
  const value = childNode(node, 'value');
  if (value === null) return undefined;
  if (value.type === 'JSXExpressionContainer') {
    const expression = childNode(value, 'expression');
    return expression && typeof nodeField(expression, 'value') === 'string'
      ? nodeField(expression, 'value') as string
      : undefined;
  }
  return typeof nodeField(value, 'value') === 'string'
    ? nodeField(value, 'value') as string
    : undefined;
}

/**
 * Extract the first portable subset: one closed host root, static host DOM,
 * direct scalar prop reads, and compiler slots with portable fallbacks.
 */
export function extractExperimentalPackageRenderPlan(
  program: t.Program,
  local: string,
  scalarProps: ReadonlySet<string>,
  slots: ReadonlySet<string>,
): ExperimentalPackageRenderPlan | undefined {
  const component = declarationFor(program, local);
  if (component === undefined) return undefined;
  const bindings = propBindings(component);
  if (bindings === undefined) return undefined;
  const body = childNode(component, 'body');
  const statements = body && childNodes(body, 'body').filter(statement =>
    statement.type !== 'EmptyStatement');
  if (statements?.length !== 1 || statements[0]!.type !== 'ReturnStatement') {
    return undefined;
  }
  const returned = childNode(statements[0]!, 'argument');
  if (returned === null) return undefined;

  const nodes = (children: readonly BaseNode[]): ExperimentalPackageRenderNode[] | undefined => {
    const output: ExperimentalPackageRenderNode[] = [];
    let text: ExperimentalPackageRenderValue[] = [];
    const flush = () => {
      if (text.length > 0) output.push({ kind: 'text', parts: text });
      text = [];
    };
    for (const child of children) {
      if (child.type === 'JSXText') {
        const value = nodeField(child, 'value');
        if (typeof value === 'string' && value !== '') {
          text.push({ kind: 'literal', value });
        }
        continue;
      }
      if (child.type === 'JSXExpressionContainer') {
        const expression = childNode(child, 'expression');
        if (expression?.type === 'JSXEmptyExpression') continue;
        if (
          expression === null ||
          expression.type === 'Identifier' && identifierLikeName(expression) === 'undefined' ||
          ['NullLiteral', 'BooleanLiteral'].includes(expression.type)
        ) {
          continue;
        }
        const value = expression && renderValue(expression, bindings, scalarProps);
        if (value === undefined) return undefined;
        text.push(value);
        continue;
      }
      flush();
      if (child.type !== 'JSXElement') return undefined;
      const nested = element(child);
      if (nested === undefined) return undefined;
      output.push(nested);
    }
    flush();
    return output;
  };

  const element = (node: BaseNode): ExperimentalPackageRenderNode | undefined => {
    const tag = jsxName(node);
    if (tag === undefined) return undefined;
    if (tag === 'slot') {
      let name = '';
      for (const attribute of childNodes(childNode(node, 'openingElement')!, 'attributes')) {
        if (attribute.type !== 'JSXAttribute') return undefined;
        const attributeKey = attributeName(attribute);
        if (attributeKey !== 'name') return undefined;
        const value = staticStringAttribute(attribute);
        if (value === undefined || value === '') return undefined;
        name = value;
      }
      if (!slots.has(name)) return undefined;
      const fallback = nodes(childNodes(node, 'children'));
      return fallback === undefined ? undefined : { kind: 'slot', name, fallback };
    }
    if (!/^[a-z][a-z0-9]*$/.test(tag)) return undefined;
    const site = initialSite(node);
    if (site === '') return undefined;
    const attributes = [] as Array<{
      name: string;
      site: string;
      value: ExperimentalPackageRenderValue;
    }>;
    for (const attribute of childNodes(childNode(node, 'openingElement')!, 'attributes')) {
      if (attribute.type !== 'JSXAttribute') return undefined;
      const name = attributeName(attribute);
      if (
        name === undefined ||
        name === 'ref' ||
        /^on/i.test(name) ||
        ['route', 'route-to', 'if', 'else-if', 'else', 'suspend', 'innerHTML'].includes(name)
      ) {
        return undefined;
      }
      if (name === 'key') continue;
      const valueNode = childNode(attribute, 'value');
      let value: ExperimentalPackageRenderValue | undefined;
      if (valueNode === null) value = { kind: 'literal', value: true };
      else if (valueNode.type === 'JSXExpressionContainer') {
        const expression = childNode(valueNode, 'expression');
        value = expression === null
          ? undefined
          : renderValue(expression, bindings, scalarProps);
      } else value = literalValue(valueNode);
      const attributeSite = initialSite(attribute);
      if (value === undefined || attributeSite === '') return undefined;
      attributes.push({ name, site: attributeSite, value });
    }
    const children = nodes(childNodes(node, 'children'));
    return children === undefined
      ? undefined
      : { kind: 'element', tag, site, attributes, children };
  };

  const root = unwrapTypeExpression(returned);
  if (root.type !== 'JSXElement') return undefined;
  const rendered = element(root);
  return rendered?.kind === 'element' ? { root: rendered } : undefined;
}

/** Package-owned bindings stay relative to their host regardless of caller placement. */
export function packageInitialDom(
  initial: ExperimentalPackageRenderPlan,
  moduleId: string,
  component: string,
): InitialDomRoot | undefined {
  if (initial.root.kind !== 'element') return undefined;
  const node = (input: ExperimentalPackageRenderNode): InitialRenderNode | undefined => {
    if (input.kind === 'slot') return undefined;
    if (input.kind === 'text') {
      // All symbolic reads remain live, including calls initially given constants.
      return { kind: 'text', value: 'package', live: input.parts.some(part => part.kind === 'prop') };
    }
    const children = input.children.map(node);
    if (children.some(child => child === undefined)) return undefined;
    return {
      kind: 'element', tag: input.tag, site: input.site,
      attributes: input.attributes.map(attribute => ({
        name: attribute.name, site: attribute.site,
        value: attribute.value.kind === 'literal' ? attribute.value.value : 'package',
        live: attribute.value.kind === 'prop',
      })),
      children: children as InitialRenderNode[],
    };
  };
  const root = node(initial.root);
  if (root === undefined) return undefined;
  const plan: Extract<InitialRenderPlan, { kind: 'bindings' }> = {
    kind: 'bindings', target: '', mountModuleId: moduleId,
    rootModuleId: moduleId, rootLocal: component, returnSite: initial.root.site,
    nodes: [root],
  };
  if (emitInitialHtml(plan) === null) return undefined;
  const dom = planInitialDom(plan);
  return dom === null ? undefined : { ...relativeInitialDom(dom), retainCreation: true };
}
