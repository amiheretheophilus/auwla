/**
 * parse: source text → checked, lowered source text (`wiki/compiler/core.md`).
 *
 * The analyzer in `core/resolve/` parses again from text, because its model is a
 * snapshot of the text it was given (`wiki/compiler/toolchain.md`). So this stage
 * hands on text: the authored module, with the TypeScript constructs that have no
 * JavaScript form lowered to JavaScript.
 */
import { findAll } from 'yuku-ast';
import { langFromPath, parse } from 'yuku-parser';
import type { SourceLang } from 'yuku-parser';
import { CompileError } from '../diagnostics';
import { lowerTypeScript, type LoweredRequireImport } from './lower-typescript';
import { lowerSlotsWithOrigin } from '../../features/slots/lower';
import { composeOrigins, UNEDITED, type TextOrigin } from './text-edits';

export type { LoweredRequireImport } from './lower-typescript';

export interface ParsedModule {
  /** The module's path, as the caller gave it. */
  readonly path: string;
  readonly lang: SourceLang;
  /** The authored text, with the TypeScript that runs lowered to JavaScript. */
  readonly source: string;
  /** The text as the caller gave it, which source maps point into. */
  readonly authored: string;
  /** Where each offset of `source` was in `authored` (`text-edits.ts`). */
  readonly origin: TextOrigin;
  /** Whether the module contains JSX. */
  readonly hasJsx: boolean;
  /** Each `import x = require('m')`, which `core/resolve/imports.ts` settles. */
  readonly requireImports: readonly LoweredRequireImport[];
  /** The module has `export =`, so its default export is what requiring it gives. */
  readonly hasExportAssignment: boolean;
}

export function parseModule(path: string, authored: string): ParsedModule {
  const lang = langFromPath(path);
  const { program, diagnostics } = parse(authored, { lang, sourceType: 'module' });

  const error = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error !== undefined) {
    throw CompileError.at(error.message, path, authored, error.start);
  }

  const hasJsx = findAll(program, ['JSXElement', 'JSXFragment']).length > 0;
  if (lang !== 'ts' && lang !== 'tsx') {
    const slots = hasJsx ? lowerSlotsWithOrigin(path, authored) : { text: authored, origin: UNEDITED };
    return { path, lang, authored, source: slots.text, origin: slots.origin, hasJsx, requireImports: [], hasExportAssignment: false };
  }
  const lowered = lowerTypeScript(program, authored, lang, path);
  // Slots become props (`features/slots/lower.ts`), on the text the TypeScript lowering left.
  const slots = hasJsx ? lowerSlotsWithOrigin(path, lowered.source) : { text: lowered.source, origin: UNEDITED };
  return {
    path,
    lang,
    authored,
    hasJsx,
    requireImports: lowered.requireImports,
    hasExportAssignment: lowered.hasExportAssignment,
    source: slots.text,
    origin: composeOrigins(slots.origin, lowered.origin),
  };
}
