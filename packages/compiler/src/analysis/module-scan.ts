/** Populates module state, helper, and component declarations. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  extractPatternIdentifiers,
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  walkAst,
  type BaseNode,
} from '../ast';
import {
  astBindingAt,
  bindingHasVisibleWrite,
  isConstObjectState,
  isStoreObject,
  registerState,
  type ComponentPath,
  type Ctx,
  type HelperPath,
  type ProgramPath,
} from '../context';
import { analyzeComponentProps } from '../components/props';
import { hostJsxEventNames } from '../jsx/events';
import { componentSlotProp } from '../jsx/component-slots';
import { moduleStateStringCandidates } from './type-candidates';
import {
  discoverTopLevelFunctions,
  findUnlinkedValueImports,
} from './module-discovery';

export function validateLinkedImports(ctx: Ctx, programPath: ProgramPath): void {
  const linked = new Set<string>([
    ...ctx.importedState,
    ...ctx.importedFunctions.keys(),
    ...ctx.importedComponents.keys(),
    ...ctx.importedValues,
  ]);
  for (const imported of findUnlinkedValueImports(
    programPath.node as unknown as BaseNode,
    linked,
  )) {
    throw programPath.buildCodeFrameError(
      `memo-dom: value import '${imported.local}' requires compileModules() so its reactive identity can be linked`,
    );
  }
}
function isExported(ctx: Ctx, declaration: t.VariableDeclarator): boolean {
  const statement = ctx.astAnalysis?.parentByNode.get(declaration as unknown as BaseNode) ?? null;
  const parent = statement === null ? null : ctx.astAnalysis?.parentByNode.get(statement) ?? null;
  if (parent?.type === 'ExportNamedDeclaration') return true;
  const program = ctx.astAnalysis?.rootScope.block as t.Program | undefined;
  const name = (declaration.id as t.Identifier).name;
  return program?.body.some(item => astFactory.isExportNamedDeclaration(item) &&
    item.specifiers.some(specifier => astFactory.isExportSpecifier(specifier) &&
      specifier.local.name === name)) === true;
}

/**
 * A module binding built by a call (`const root = build()`) holds a mutable
 * object like a literal or `new X()` does. Its writes may happen anywhere:
 * importers, local aliases, helper parameters and helper results, none of
 * which name the binding itself. Computed analysis later reclassifies a call
 * that reads reactive state as a derivation; compiler-owned sources and
 * promises replayed by `$read` keep their own lowering. An unreferenced
 * binding cannot be observed, so it stays plain.
 */
function isBuiltModuleObject(ctx: Ctx, declaration: t.VariableDeclarator): boolean {
  if (!astFactory.isIdentifier(declaration.id) || declaration.init == null) return false;
  if (ctx.transparentModuleSources.has(declaration.id.name) ||
      ctx.readReplayOrigins.has(declaration)) return false;
  const binding = astBindingAt(ctx, declaration as unknown as BaseNode, declaration.id.name);
  if (binding === undefined || (binding.references.length === 0 && !isExported(ctx, declaration))) {
    return false;
  }
  let init: t.Node = declaration.init;
  while (astFactory.isTransparentExpression(init)) init = init.expression;
  if (astFactory.isAwaitExpression(init)) init = init.argument;
  return astFactory.isCallExpression(init);
}

export function scanModuleState(ctx: Ctx, programPath: ProgramPath): void {
  const tagCandidates = moduleStateStringCandidates(programPath.node);
  const destructured: {
    declaration: t.VariableDeclarator;
    kind: string;
  }[] = [];
  for (const stmt of programPath.node.body) {
    // M5.5: exported state is still state — unwrap the export wrapper
    const inner = astFactory.isExportNamedDeclaration(stmt) ? stmt.declaration : stmt;
    if (!astFactory.isVariableDeclaration(inner)) continue;
    for (const decl of inner.declarations) {
      if (!astFactory.isIdentifier(decl.id)) {
        destructured.push({ declaration: decl, kind: inner.kind });
        continue;
      }
      if (inner.kind === 'let' || inner.kind === 'var') {
        const binding = astBindingAt(
          ctx,
          decl as unknown as BaseNode,
          decl.id.name,
        );
        if (bindingHasVisibleWrite(ctx, binding)) {
          registerState(ctx, decl.id.name, 'let');
        } else if (isStoreObject(decl.init)) {
          registerState(ctx, decl.id.name, 'store');
        } else if (isConstObjectState(decl.init) || isBuiltModuleObject(ctx, decl)) {
          registerState(ctx, decl.id.name, 'const');
        }
      } else if (inner.kind === 'const') {
        if (isStoreObject(decl.init)) {
          registerState(ctx, decl.id.name, 'store');
        } else if (isConstObjectState(decl.init) || isBuiltModuleObject(ctx, decl)) {
          registerState(ctx, decl.id.name, 'const');
        }
      }
      if (ctx.state.has(decl.id.name)) {
        const candidates = tagCandidates.get(decl.id.name);
        if (candidates !== undefined) {
          ctx.stateTagCandidates.set(decl.id.name, [...candidates]);
        }
      }
    }
  }
  // Destructured bindings never enter the state table, so writes to them and
  // snapshot reads of reactive roots would go stale with no signal. Reject
  // the two observable cases; inert patterns compile unchanged.
  for (const { declaration, kind } of destructured) {
    for (const { name } of extractPatternIdentifiers(
      declaration.id as unknown as BaseNode,
    )) {
      const binding = astBindingAt(
        ctx,
        declaration as unknown as BaseNode,
        name,
      );
      if (
        (kind === 'let' || kind === 'var') &&
        bindingHasVisibleWrite(ctx, binding)
      ) {
        throw programPath.buildCodeFrameError(
          `memo-dom: destructured module binding '${name}' is written but cannot be tracked; declare it as a plain '${kind}' binding instead`,
          declaration as unknown as t.Node,
        );
      }
    }
    const init = declaration.init;
    if (init === null || init === undefined) continue;
    let snapshotRoot: string | null = null;
    walkAst(init as unknown as BaseNode, {
      enter(node) {
        if (snapshotRoot !== null) return false;
        // Reads inside nested functions are deferred to call time, not
        // snapshots frozen at module evaluation.
        if (FUNCTION_NODES.has(node.type)) return false;
        if (node.type !== 'Identifier') return;
        const name = (node as unknown as { name?: string }).name;
        if (typeof name !== 'string') return;
        const binding = astBindingAt(ctx, node, name);
        if (
          binding !== undefined &&
          binding.scope.isProgramScope === true &&
          ctx.state.has(name)
        ) {
          snapshotRoot = name;
        }
      },
    });
    if (snapshotRoot !== null) {
      throw programPath.buildCodeFrameError(
        `memo-dom: destructuring '${snapshotRoot}' snapshots reactive state that cannot be tracked; assign the value directly or destructure inside a component`,
        declaration as unknown as t.Node,
      );
    }
  }
}

/**
 * Top-level `function` declarations split by content: with JSX → component
 * (transformed), without → helper (left alone, summarized). Top-level arrow
 * and function-expression variables without JSX are helpers as well. M5.3
 * previously treated every declaration as a component.
 */
export function scanComponents(ctx: Ctx, programPath: ProgramPath): void {
  const unwrapFunctionNode = (
    raw: t.Node | null | undefined,
  ): HelperPath['node'] | null => {
    if (raw === null || raw === undefined) return null;
    let current = raw;
    while (astFactory.isTransparentExpression(current)) {
      current = current.expression;
    }
    if (astFactory.isArrowFunctionExpression(current)) return current;
    return astFactory.isFunctionExpression(current) ? current : null;
  };

  const functionPaths = new Map<t.Node, HelperPath>();
  const asPath = (node: HelperPath['node']): HelperPath => ({
    node,
    buildCodeFrameError(message, at = node) {
      return programPath.buildCodeFrameError(message, at);
    },
  });
  for (const statement of programPath.node.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ||
      astFactory.isExportDefaultDeclaration(statement)
      ? statement.declaration
      : statement;
    if (astFactory.isFunctionDeclaration(declaration)) {
      functionPaths.set(declaration, asPath(declaration));
      continue;
    }
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    for (const declarator of declaration.declarations) {
      const init = unwrapFunctionNode(declarator.init);
      if (init !== null) {
        functionPaths.set(init, asPath(init));
      }
    }
  }

  for (const discovered of discoverTopLevelFunctions(
    programPath.node as unknown as BaseNode,
  )) {
    if (
      ctx.comps.has(discovered.name) ||
      ctx.helpers.has(discovered.name) ||
      ctx.jsxHelpers.has(discovered.name)
    ) {
      continue;
    }
    const path = functionPaths.get(discovered.node as unknown as t.Node);
    if (path === undefined) continue;
    if (discovered.kind === 'helper') {
      ctx.helpers.set(discovered.name, path);
      continue;
    }
    if (discovered.kind === 'jsx-helper') {
      ctx.jsxHelpers.set(discovered.name, path);
      continue;
    }
    if (path.node.type !== 'FunctionDeclaration') continue;
    const componentPath = path as unknown as ComponentPath;
    ctx.comps.set(discovered.name, { parents: new Set(), jsxCount: 0 });
    ctx.compPaths.set(discovered.name, componentPath);
    const hostEvents = hostJsxEventNames(componentPath.node.body);
    ctx.componentHostEvents.set(discovered.name, hostEvents);
    if (hostEvents.length !== 0) {
      ctx.componentsWithHostEvents.add(discovered.name);
    }
    try {
      const props = analyzeComponentProps(componentPath.node.params);
      props.slots = [...(ctx.componentSlots.get(discovered.name) ?? [])];
      props.renderProps.push(...props.slots.map(componentSlotProp));
      ctx.componentProps.set(discovered.name, props);
    } catch (error) {
      throw path.buildCodeFrameError(
        `memo-dom: invalid props for component '${discovered.name}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
