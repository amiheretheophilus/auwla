/**
 * Source languages: authoring syntaxes that become TSX before the compiler reads them
 * (`wiki/compiler/core.md`, "Source languages").
 *
 * A language owns file extensions (`.auwla`) and turns a module's text into TSX, saying where
 * each offset of that TSX was in the authored text. Everything after that is the compiler's, as
 * for any `.tsx` module: imports, routes, planning, emission, projects, the Bun and Vite plugins.
 * The module keeps its authored path (`./App.auwla`), so outputs, imports and source maps name the
 * file the author wrote. Source maps follow the origin back to the authored text, and an error
 * found after parsing is moved back to it too (`authoredError`).
 *
 * A language is plain code: it reads no files and needs no particular runtime. The compiler knows
 * nothing about any one language; `packages/jsx-plus` gives `.auwla`.
 */
import { langFromPath, type SourceLang } from 'yuku-parser';
import { CompileError, locate } from '../diagnostics';
import { UNEDITED, type TextOrigin } from './text-edits';

export interface SourceLanguage {
  /** The extensions the language owns, with their dot: `['.auwla']`. */
  readonly extensions: readonly string[];
  /**
   * The module as TSX, and where each offset of that TSX was in `text`. An authored error is
   * thrown as a `CompileError` located in `text`.
   */
  toTsx(text: string, path: string): {
    readonly code: string;
    readonly origin: TextOrigin;
    /** Optional static CSS. The compiler owns its asset name, import and delivery. */
    readonly stylesheet?: string;
  };
}

export interface SourceStylesheet {
  readonly path: string;
  readonly code: string;
}

/** The language owning `path`, if one does. */
export function languageOf(path: string, languages: readonly SourceLanguage[] | undefined): SourceLanguage | undefined {
  return languages?.find((language) => language.extensions.some((extension) => path.endsWith(extension)));
}

/** Every extension the languages own, in the order they were given. */
export function languageExtensions(languages: readonly SourceLanguage[] | undefined): readonly string[] {
  return languages?.flatMap((language) => language.extensions) ?? [];
}

/** The text the parser reads for a module, the language it reads it as, and where that text came from. */
export function moduleText(
  path: string,
  authored: string,
  languages: readonly SourceLanguage[] | undefined,
): { readonly text: string; readonly lang: SourceLang; readonly origin: TextOrigin; readonly stylesheet?: SourceStylesheet } {
  const language = languageOf(path, languages);
  if (language === undefined) return { text: authored, lang: langFromPath(path), origin: UNEDITED };
  const { code, origin, stylesheet } = language.toTsx(authored, path);
  if (stylesheet === undefined) {
    return { text: code, lang: 'tsx', origin };
  }

  // A companion in the same directory keeps authored CSS URLs relative to their module.
  // Append the import: this preserves shebangs, directives and every existing code offset.
  const asset = `${path}.css`;
  const basename = asset.slice(asset.lastIndexOf('/') + 1);
  const text = `${code}\nimport ${JSON.stringify(`./${basename}`)};\n`;
  return { text, lang: 'tsx', origin, stylesheet: { path: asset, code: stylesheet } };
}

/** What `authoredError` needs of a module: the text the analyzer read, and the way back. */
export interface AnalyzedText {
  readonly path: string;
  /** The text errors are located in. */
  readonly analyzed: string;
  readonly authored: string;
  readonly origin: TextOrigin;
}

/**
 * An error found after parsing, moved from the analyzed text to the authored text, for a module a
 * language wrote. Stages locate their errors in the text they read, which for such a module is
 * TSX the author never saw. Anything else is returned as it is.
 */
export function authoredError(
  error: unknown,
  modules: readonly AnalyzedText[],
  languages: readonly SourceLanguage[] | undefined,
): unknown {
  if (!(error instanceof CompileError) || error.line === undefined || error.column === undefined) return error;
  if (languageOf(error.path, languages) === undefined) return error;
  const module = modules.find((entry) => entry.path === error.path);
  if (module === undefined) return error;

  const offset = offsetAt(module.analyzed, error.line, error.column);
  if (offset === undefined) return error;
  const { line, column } = locate(module.authored, module.origin.original(offset));
  return new CompileError(error.reason, error.path, line, column);
}

/** The UTF-16 offset of a one-based line and column, as `locate` counts them. */
function offsetAt(text: string, line: number, column: number): number | undefined {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const newline = text.indexOf('\n', offset);
    if (newline < 0) return undefined;
    offset = newline + 1;
  }
  return offset + column - 1;
}
