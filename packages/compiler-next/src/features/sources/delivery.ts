/**
 * The public `$fetch` carries what any call might need: body encoding, a promise for an
 * action, and restoring server data. A module whose every use is a call that loads with
 * no body needs less, so it imports a smaller function that behaves the same for those
 * calls. In a client-only build it also needs no restoring (`wiki/compiler/sources.md`,
 * "Delivery").
 */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import { statement } from '../../core/emit/quote';
import type { Module } from '../../core/resolve';
import type { CompileModulesOptions } from '../../options';
import { unwrap } from '../../core/plan/jsx';
import { fetchMethod, staticPropertyName } from './classify';

const PUBLIC_DATA = '@memoized-dom/data';
const INTERNAL_DATA = '@memoized-dom/data/internal';

type Call = Extract<Node, { type: 'CallExpression' }>;

/**
 * `$fetch(url)` or `$fetch(url, { query })`: a GET, the only method whose result is a
 * source rather than a promise, with no body to encode. Options the compiler cannot read
 * may hold either, so they do not count.
 */
function loadsWithoutBody(call: Call): boolean {
  const [target, options] = call.arguments;
  if (target === undefined || call.arguments.length > 2 || call.arguments.some((argument) => is.SpreadElement(argument))) return false;
  if (fetchMethod(call) !== 'GET') return false;
  if (options === undefined) return true;

  const value = unwrap(options);
  return is.ObjectExpression(value) && value.properties.every((property) => {
    return is.Property(property) && staticPropertyName(property.key, property.computed) !== 'body';
  });
}

/** Whether `name` is an import of `$fetch` used only as such calls. */
function everyUseLoads(module: Module, local: string): boolean {
  const imported = module.imports.find((entry) => {
    return entry.specifier === PUBLIC_DATA && entry.name === '$fetch' && entry.local?.name === local && !entry.typeOnly;
  });
  if (imported?.local == null) return false;

  const uses = imported.local.references.filter((reference) => !reference.inTypePosition);
  return uses.length > 0 && uses.every((reference) => {
    const parent = module.parentOf(reference.node);
    return parent !== null && is.CallExpression(parent) && parent.callee === reference.node && loadsWithoutBody(parent);
  });
}

/** Rewrites this module's `$fetch` import in the emitted program, where proven. */
export function lowerFetchImport(
  program: Extract<Node, { type: 'Program' }>,
  module: Module,
  options: CompileModulesOptions,
): void {
  const replacement = options.dataDelivery === 'client' ? 'createClientSource' : 'createBodylessSource';

  for (const declaration of [...program.body]) {
    if (!is.ImportDeclaration(declaration) || declaration.source.value !== PUBLIC_DATA) continue;

    for (const specifier of [...declaration.specifiers]) {
      if (!is.ImportSpecifier(specifier) || !is.Identifier(specifier.imported) || specifier.imported.name !== '$fetch') continue;

      const local = specifier.local.name;
      if (!everyUseLoads(module, local)) continue;

      declaration.specifiers.splice(declaration.specifiers.indexOf(specifier), 1);
      const lowered = statement(`import { ${replacement} as ${local} } from "${INTERNAL_DATA}";`);
      program.body.splice(program.body.indexOf(declaration), 0, lowered as never);
    }
    if (declaration.specifiers.length === 0) program.body.splice(program.body.indexOf(declaration), 1);
  }
}
