/**
 * Ambient framework data calls.
 *
 * The framework declares `$fetch`, `$read`, `$track` and `$forms` as globals
 * (`packages/compiler/src/jsx-types.ts`) and the compiler supplies their
 * imports, so authored modules may call them without importing them. A module
 * that does gets the import appended to its text before analysis. Every later
 * stage then resolves the call by binding identity, exactly as for an explicit
 * import. Appending keeps every authored line and column in place.
 *
 * `$routed` and `$snapshot` are declared there too; they arrive with their own
 * phases (`wiki/compiler/plan.md`).
 */
import type { Module } from 'yuku-analyzer';

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
