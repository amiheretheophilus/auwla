/**
 * parse: source text → checked, lowered source text (`wiki/compiler/core.md`).
 *
 * The analyzer in `core/resolve/` parses again from text, because its model is a
 * snapshot of the text it was given (`wiki/compiler/toolchain.md`). So this stage
 * hands on text: the authored module, with the TypeScript constructs that have no
 * JavaScript form lowered to JavaScript.
 */
import { findAll } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { SourceLang } from 'yuku-parser';
import { CompileError } from '../diagnostics';
import { authoredError, moduleText, type SourceLanguage, type SourceStylesheet } from './languages';
import { lowerTypeScript, type LoweredRequireImport } from './lower-typescript';
import { lowerSlotsWithOrigin } from '../../features/slots/lower';
import { composeOrigins, UNEDITED, type TextOrigin } from './text-edits';

export type { LoweredRequireImport } from './lower-typescript';

export interface ParsedModule {
  readonly stylesheet?: SourceStylesheet;
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

/**
 * `languages`: a module whose extension a source language owns is read as the TSX the language
 * gives (`languages.ts`). `authored` stays the text as written, and `origin` leads back to it.
 */
export function parseModule(path: string, authored: string, languages?: readonly SourceLanguage[]): ParsedModule {
  const written = moduleText(path, authored, languages);
  const { text, lang } = written;
  const { program, diagnostics } = parse(text, { lang, sourceType: 'module' });

  const error = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error !== undefined) {
    throw CompileError.at(error.message, path, authored, written.origin.original(error.start));
  }

  const hasJsx = findAll(program, ['JSXElement', 'JSXFragment']).length > 0;
  try {
    return lowerModule(path, authored, written, program, hasJsx);
  } catch (error) {
    // Lowering locates its errors in the text it read, the language's TSX for such a module.
    throw authoredError(error, [{ path, analyzed: text, authored, origin: written.origin }], languages);
  }
}

/** The module with the TypeScript that runs, and slots, lowered (`lower-typescript.ts`, `features/slots/`). */
function lowerModule(
  path: string,
  authored: string,
  written: ReturnType<typeof moduleText>,
  program: Parameters<typeof lowerTypeScript>[0],
  hasJsx: boolean,
): ParsedModule {
  const { text, lang } = written;
  if (lang !== 'ts' && lang !== 'tsx') {
    const slots = hasJsx ? lowerSlotsWithOrigin(path, text) : { text, origin: UNEDITED };
    return {
      ...(written.stylesheet === undefined ? {} : { stylesheet: written.stylesheet }),
      path, lang, authored, source: slots.text, origin: composeOrigins(slots.origin, written.origin),
      hasJsx, requireImports: [], hasExportAssignment: false,
    };
  }
  const lowered = lowerTypeScript(program, text, lang, path);
  // Slots become props (`features/slots/lower.ts`), on the text the TypeScript lowering left.
  const slots = hasJsx ? lowerSlotsWithOrigin(path, lowered.source) : { text: lowered.source, origin: UNEDITED };
  return {
    ...(written.stylesheet === undefined ? {} : { stylesheet: written.stylesheet }),
    path,
    lang,
    authored,
    hasJsx,
    requireImports: lowered.requireImports,
    hasExportAssignment: lowered.hasExportAssignment,
    source: slots.text,
    origin: composeOrigins(slots.origin, composeOrigins(lowered.origin, written.origin)),
  };
}
