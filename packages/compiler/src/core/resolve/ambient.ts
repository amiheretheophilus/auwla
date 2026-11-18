/**
 * Ambient framework data calls.
 *
 * The framework declares `$fetch`, `$read`, `$track` and `$forms` as globals
 * (`src/jsx-types.ts`) and the compiler supplies their
 * imports, so authored modules may call them without importing them. A module
 * that does gets the import appended to its text before analysis. Every later
 * stage then resolves the call by binding identity, exactly as for an explicit
 * import. Appending keeps every authored line and column in place.
 *
 * `$routed` is declared there too, and is compiler syntax with or without an import: the routes
 * pass lowers every call (`features/routes/routed.ts`). So is `$snapshot`, recognized here
 * (`snapshotCalls`) and lowered by `features/state/snapshot.ts`.
 */
import { is } from 'yuku-ast';
import type { Module } from 'yuku-analyzer';
import type { Node } from 'yuku-parser';

const AMBIENT_DATA = new Set(['$fetch', '$read', '$track', '$forms']);

/** The text with the missing data imports appended, or null when none is used. */
export function withAmbientImports(module: Module, source: string): string | null {
  const used = new Set<string>();
  const written = new Set<string>();

  for (const reference of module.unresolvedReferences) {
    if (reference.inTypePosition || !AMBIENT_DATA.has(reference.name)) {
      continue;
    }

    if (reference.isWrite) {
      written.add(reference.name);
    } else {
      used.add(reference.name);
    }
  }

  // Code that assigns the global itself keeps the global: an import would
  // turn that assignment into an error.
  const names = [...used].filter((name) => !written.has(name)).sort();

  if (names.length === 0) {
    return null;
  }

  return `${source}\nimport { ${names.join(', ')} } from '@memoized-dom/data';\n`;
}

/**
 * The ambient lifecycle call `node` makes, recognized by binding: a local
 * `$effect` is an ordinary function (`effects.md`).
 */
export function lifecycleKind(module: Module, node: Node): '$effect' | '$cleanup' | null {
  if (!is.CallExpression(node) || !is.Identifier(node.callee)) return null;
  if (node.callee.name !== '$effect' && node.callee.name !== '$cleanup') return null;
  return module.referenceOf(node.callee)?.binding == null ? node.callee.name : null;
}

type CallNode = Extract<Node, { type: 'CallExpression' }>;

/** Each module's `$snapshot` calls, found once. */
const snapshotsByModule = new WeakMap<Module, readonly CallNode[]>();

/**
 * The `$snapshot(...)` calls in `module` (`features/state/snapshot.ts`): a value taken once, whose
 * reads are no input of anything. Empty when the module declares or assigns its own `$snapshot`,
 * which is then an ordinary function.
 */
export function snapshotCalls(module: Module): readonly CallNode[] {
  const known = snapshotsByModule.get(module);
  if (known !== undefined) return known;

  const references = module.unresolvedReferences.filter((reference) => !reference.inTypePosition && reference.name === '$snapshot');
  const calls: CallNode[] = [];
  // Code that assigns the global itself has a function of that name, not the marker.
  if (!references.some((reference) => reference.isWrite)) {
    for (const reference of references) {
      const parent = module.parentOf(reference.node);
      if (parent !== null && is.CallExpression(parent) && parent.callee === reference.node) calls.push(parent);
    }
  }
  snapshotsByModule.set(module, calls);
  return calls;
}

/**
 * Whether `node` is a `$snapshot` call or inside one, so that what it reads and calls is no input
 * of anything. Compared by source position.
 */
export function insideSnapshot(module: Module, node: Node): boolean {
  const calls = snapshotCalls(module);
  return calls.length > 0 && calls.some((call) => node.start >= call.start && node.end <= call.end);
}
