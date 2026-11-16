/**
 * Mistakes in a component's parameters that the old compiler's positional props made easy
 * (`wiki/compiler/components.md`, "One props object"; `wiki/decisions.md`, 2026-11-16).
 *
 * A component used as a JSX tag receives exactly one argument, its props object, as in plain
 * JavaScript. The old compiler instead gave each parameter the prop of its name, so code written
 * for it reads wrong here, without any error at run time:
 *
 * - `function Row(item, sfx)` with `<Row item={…} sfx="!" />`: `sfx` is always `undefined`;
 * - `function Count(value)` showing `{value}`: `value` is the whole props object, so the page
 *   shows "[object Object]".
 *
 * Both are compile errors. A capitalized function that is only called (`items.map(Row)`,
 * `Label('x', 2)`) is a plain function and may take any parameters.
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import type { Module, Resolved, ResolvedModule } from '../../core/resolve';
import { functionValue } from '../../core/resolve/functions';
import type { FunctionNode } from '../../core/resolve/functions';

/** How the program uses one component function. */
interface ComponentUses {
  readonly module: ResolvedModule;
  /** Used as a JSX tag somewhere in the program, so it receives one props object. */
  tag: boolean;
  /** Used any other way too (called, passed along, reached from outside the program). */
  other: boolean;
}

/** Throws a `CompileError` for the first parameter mistake in a component used as a tag. */
export function checkComponentParameters(resolved: Resolved, components: ReadonlySet<FunctionNode>): void {
  const uses = componentUses(resolved, components);
  for (const [fn, use] of uses) {
    if (!use.tag) {
      continue;
    }
    checkOneParameter(fn, use.module);
    // Only a function never called directly is sure to receive an object in its first parameter.
    if (!use.other) {
      checkPropsNotShown(fn, use.module);
    }
  }
}

/** Which components are used as tags, and which are used in other ways as well. */
function componentUses(resolved: Resolved, components: ReadonlySet<FunctionNode>): Map<FunctionNode, ComponentUses> {
  const uses = new Map<FunctionNode, ComponentUses>();

  // Where each component is defined, and whether code outside the program can call it.
  for (const entry of resolved.modules) {
    const module = entry.module;
    for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
      if (!components.has(fn as FunctionNode)) {
        continue;
      }
      const name = functionName(module, fn as FunctionNode);
      const binding = name === null ? null : module.bindingOf(name);
      // Code outside the program can call only what a module exports, and only if the module is
      // reachable from outside (`usedOutside`). A function with no name is not followed here.
      const exported = binding === null
        || module.exportedNames().some((exportedName) => module.resolveExport(exportedName)?.binding === binding);
      uses.set(fn as FunctionNode, { module: entry, tag: false, other: exported && resolved.usedOutside(module, binding) });
    }
  }

  // Every use of a component, in any module: as a tag (`<Row … />`), or anything else.
  for (const entry of resolved.modules) {
    const module = entry.module;
    for (const opening of module.findAll('JSXOpeningElement')) {
      const fn = functionValue(module, opening.name);
      const use = fn === null ? undefined : uses.get(fn);
      if (use !== undefined) {
        use.tag = true;
      }
    }
    for (const reference of module.references) {
      if (reference.inTypePosition || reference.isWrite) {
        continue;
      }
      const parent = module.parentOf(reference.node);
      // Naming a value is not using it: `export { Row }`, `import { Row }`.
      if (parent !== null && (is.ExportSpecifier(parent) || is.ImportSpecifier(parent) || is.ImportDefaultSpecifier(parent))) {
        continue;
      }
      const fn = functionValue(module, reference.node);
      const use = fn === null ? undefined : uses.get(fn);
      if (use === undefined) {
        continue;
      }
      // Tag names were counted above.
      if (parent === null || !(is.JSXOpeningElement(parent) || is.JSXClosingElement(parent))) {
        use.other = true;
      }
    }
  }
  return uses;
}

/** `function Row(item, sfx)` used as `<Row … />`: everything after the first parameter is undefined. */
function checkOneParameter(fn: FunctionNode, entry: ResolvedModule): void {
  const extra = fn.params[1];
  if (extra === undefined) {
    return;
  }
  const module = entry.module;
  const tag = functionName(module, fn)?.name ?? 'this component';
  const names = fn.params.map(parameterName);
  const suggestion = names.every((name) => name !== null)
    ? ` Write \`function ${tag}({ ${names.join(', ')} })\` to take those props.`
    : ' Take every prop from the first parameter.';
  throw CompileError.at(
    `<${tag}> is used as a tag, so it receives one props object and its parameters after the first are always undefined.${suggestion}`,
    entry.path,
    module.source,
    extra.start,
  );
}

/** `function Count(value)` showing `{value}`: the whole props object as text, "[object Object]". */
function checkPropsNotShown(fn: FunctionNode, entry: ResolvedModule): void {
  const first = fn.params[0];
  const name = first === undefined ? null : parameterIdentifier(first);
  if (name === null) {
    return;
  }
  const module = entry.module;
  const binding = module.bindingOf(name);
  // A reassigned parameter may hold anything by the time it is shown.
  if (binding === null || binding.references.some((reference) => reference.isWrite)) {
    return;
  }
  for (const reference of binding.references) {
    const container = module.parentOf(reference.node);
    if (container === null || !is.JSXExpressionContainer(container) || container.expression !== reference.node) {
      continue;
    }
    // A child shows its value as text; an attribute (`data={props}`) passes it on.
    const holder = module.parentOf(container);
    if (holder === null || !(is.JSXElement(holder) || is.JSXFragment(holder))) {
      continue;
    }
    const tag = functionName(module, fn)?.name ?? 'this component';
    throw CompileError.at(
      `\`${name.name}\` is the whole props object of <${tag}>, so \`{${name.name}}\` shows "[object Object]". `
        + `To take the prop named \`${name.name}\`, write \`function ${tag}({ ${name.name} })\`.`,
      entry.path,
      module.source,
      reference.node.start,
    );
  }
}

/** The name a function is declared or assigned under: `function Row`, `const Row = () => …`. */
function functionName(module: Module, fn: FunctionNode): Extract<Node, { type: 'Identifier' }> | null {
  if (fn.id !== null && fn.id !== undefined) {
    return fn.id;
  }
  const parent = module.parentOf(fn);
  return parent !== null && is.VariableDeclarator(parent) && is.Identifier(parent.id) ? parent.id : null;
}

/** The identifier of a plain parameter, with or without a default (`props`, `props = {}`). */
function parameterIdentifier(param: Node): Extract<Node, { type: 'Identifier' }> | null {
  if (is.Identifier(param)) {
    return param;
  }
  if (is.AssignmentPattern(param) && is.Identifier(param.left)) {
    return param.left;
  }
  return null;
}

/** A parameter's name for the suggested destructuring, or null for a pattern or rest. */
function parameterName(param: Node): string | null {
  return parameterIdentifier(param)?.name ?? null;
}
