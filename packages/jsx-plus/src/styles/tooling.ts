/** Shared CSS assistance. Editor adapters only translate protocol objects. */
import { getCSSLanguageService, type CompletionItem, type Range } from 'vscode-css-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { blank, blankRange } from '../masks';
import { readStyleBlocks, type StyleBlock } from './blocks';
import { JsxPlusError } from '../diagnostics';
import { recoverCss } from './recovery';
import { readConditions } from './conditions/model';
import { readStyleUses, styleChunks } from './uses';

const service = getCSSLanguageService();

export interface CssUseProblem {
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly relatedInformation?: readonly {
    readonly message: string;
    readonly location: { readonly uri: string; readonly range: Range };
  }[];
}

/** Equal-width CSS projection: positions and edits already name the authored file. */
export function createCssSession(
  source: string, uri: string, version = 0,
  options: { readonly useProblems?: readonly CssUseProblem[] } = {},
) {
  let blocks: readonly StyleBlock[];
  try {
    blocks = readStyleBlocks(source, uri, true).blocks;
  } catch (error) {
    if (!(error instanceof JsxPlusError)) {
      throw error;
    }
    return undefined;
  }

  if (blocks.length === 0) {
    return undefined;
  }

  let projected = '';
  let position = 0;
  for (const block of blocks) {
    projected += blank(source.slice(position, block.bodyStart));
    projected += source.slice(block.bodyStart, block.bodyEnd);
    position = block.bodyEnd;
  }
  projected += blank(source.slice(position));

  const document = TextDocument.create(uri, 'css', version, projected);
  const conditions = readConditions(projected);
  const groups = [...conditions.groups.values()];
  const uses = readStyleUses(projected);
  const useProblems: CssUseProblem[] = [...options.useProblems ?? []];
  if (options.useProblems === undefined) {
    styleChunks(source, uri, blocks, (message, start, end) => useProblems.push({ message, start, end }), { deferExternal: true });
  }
  let checking = projected;
  for (const header of conditions.headers) {
    checking = blankRange(checking, header.start, header.end);
  }
  for (const group of groups) {
    checking = blankRange(checking, group.start, group.headerEnd);
    // A neutral qualified rule gives the native service a declaration/nesting
    // context even when @700 is too short for an equal-width @media spelling.
    checking = checking.slice(0, group.start) + '*' + checking.slice(group.start + 1);
  }
  for (const use of [...uses.uses, ...uses.problems]) {
    checking = blankRange(checking, use.start, use.end);
  }
  const checkingDocument = TextDocument.create(uri, 'css', version, checking);
  const recovered = recoverCss(service, checkingDocument);
  const stylesheet = recovered.stylesheet;
  const contains = (offset: number) => blocks.some((block) => block.bodyStart <= offset && offset <= block.bodyEnd);
  const inHeader = (offset: number) => conditions.headers.some((header) => header.start <= offset && offset < header.end)
    || groups.some((group) => group.start <= offset && offset < group.headerEnd);
  const inUse = (offset: number) => [...uses.uses, ...uses.problems].some((use) => use.start <= offset && offset < use.end);

  function editable(range: Range): boolean {
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    return blocks.some((block) => block.bodyStart <= start && end <= block.bodyEnd);
  }

  function safeCompletion(item: CompletionItem): boolean {
    if (item.textEdit !== undefined) {
      const edit = item.textEdit;
      if ('range' in edit) {
        if (!editable(edit.range)) {
          return false;
        }
      } else if (!editable(edit.insert) || !editable(edit.replace)) {
        return false;
      }
    }
    return (item.additionalTextEdits ?? []).every((edit) => editable(edit.range));
  }

  // CSS recovery often reports a missing brace at EOF, after the blanked host code.
  // Keep that diagnostic at the last authored CSS position rather than discarding it.
  function authoredPosition(offset: number): number {
    let previous = blocks[0]!.bodyStart;
    for (const block of blocks) {
      if (offset < block.bodyStart) {
        break;
      }
      if (offset <= block.bodyEnd) {
        return offset;
      }
      previous = block.bodyEnd;
    }
    return previous;
  }

  return {
    contains,
    hasUses: uses.uses.length > 0 || uses.problems.length > 0,
    complete(offset: number) {
      if (!contains(offset) || inHeader(offset) || inUse(offset)) {
        return undefined;
      }
      const result = service.doComplete(document, document.positionAt(offset), stylesheet);
      return { ...result, items: result.items.filter(safeCompletion) };
    },
    hover(offset: number) {
      return contains(offset) && !inHeader(offset) && !inUse(offset)
        ? service.doHover(document, document.positionAt(offset), stylesheet) : undefined;
    },
    diagnostics() {
      const problems: (CssUseProblem & { readonly code: string })[] = [
        ...conditions.problems.map((problem) => ({ ...problem, code: 'CSS2001' })),
        ...useProblems.map((problem) => ({ ...problem, code: 'CSS3001' })),
      ];
      const syntax = problems.map((problem) => ({
        code: problem.code, source: 'auwla', message: problem.message, severity: 1 as const,
        range: { start: document.positionAt(problem.start), end: document.positionAt(problem.end) },
        ...(problem.relatedInformation === undefined ? {} : { relatedInformation: problem.relatedInformation }),
      }));
      // Empty media groups are valid. Only the neutral checking selector makes
      // them look like empty qualified rules; keep genuine empty-rule warnings.
      const native = recovered.diagnostics.filter((diagnostic) => {
        const offset = document.offsetAt(diagnostic.range.start);
        return diagnostic.code !== 'emptyRules'
          || !groups.some((group) => group.start <= offset && offset < group.headerEnd);
      });
      const authoredNative = native.map((diagnostic) => ({
        ...diagnostic,
        range: {
          start: document.positionAt(authoredPosition(document.offsetAt(diagnostic.range.start))),
          end: document.positionAt(authoredPosition(document.offsetAt(diagnostic.range.end))),
        },
      }));
      return [...syntax, ...authoredNative];
    },
  };
}
