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

/** Equal-width CSS projection: positions and edits already name the authored file. */
export function createCssSession(source: string, uri: string, version = 0) {
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
  const uses = readStyleUses(projected);
  const useProblems: { message: string; start: number; end: number }[] = [];
  styleChunks(source, uri, blocks, (message, start, end) => useProblems.push({ message, start, end }), { deferExternal: true });
  let checking = projected;
  for (const header of conditions.headers) {
    checking = blankRange(checking, header.start, header.end);
  }
  for (const use of [...uses.uses, ...uses.problems]) {
    checking = blankRange(checking, use.start, use.end);
  }
  const checkingDocument = TextDocument.create(uri, 'css', version, checking);
  const recovered = recoverCss(service, checkingDocument);
  const stylesheet = recovered.stylesheet;
  const contains = (offset: number) => blocks.some((block) => block.bodyStart <= offset && offset <= block.bodyEnd);
  const inHeader = (offset: number) => conditions.headers.some((header) => header.start <= offset && offset < header.end);
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
      const syntax = [
        ...conditions.problems.map((problem) => ({ ...problem, code: 'CSS2001' })),
        ...useProblems.map((problem) => ({ ...problem, code: 'CSS3001' })),
      ].map((problem) => ({
        code: problem.code, source: 'auwla', message: problem.message, severity: 1 as const,
        range: { start: document.positionAt(problem.start), end: document.positionAt(problem.end) },
      }));
      return [...syntax, ...recovered.diagnostics].map((diagnostic) => ({
        ...diagnostic,
        range: {
          start: document.positionAt(authoredPosition(document.offsetAt(diagnostic.range.start))),
          end: document.positionAt(authoredPosition(document.offsetAt(diagnostic.range.end))),
        },
      }));
    },
  };
}
