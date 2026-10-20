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
import { lowerTypeScript } from './lower-typescript';

export interface ParsedModule {
  /** The module's path, as the caller gave it. */
  readonly path: string;
  readonly lang: SourceLang;
  /** The authored text, with `enum` and parameter properties lowered. */
  readonly source: string;
  /** Whether the module contains JSX. */
  readonly hasJsx: boolean;
}

export function parseModule(path: string, authored: string): ParsedModule {
  const lang = langFromPath(path);
  const { program, diagnostics } = parse(authored, { lang, sourceType: 'module' });

  const error = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (error !== undefined) {
    throw CompileError.at(error.message, path, authored, error.start);
  }

  const source = lang === 'ts' || lang === 'tsx' ? lowerTypeScript(program, authored) : authored;
  const hasJsx = findAll(program, ['JSXElement', 'JSXFragment']).length > 0;
  return { path, lang, source, hasJsx };
}
