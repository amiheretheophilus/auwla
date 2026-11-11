/**
 * Editor-recovery guesses attached to errors (`Repair` in diagnostics.ts). The
 * reporter knows what is likely missing; recovery verifies each guess by reading
 * the file again (`checking/recovery/markup.ts`). Builds never use these.
 */
import type { Repair } from './diagnostics';
import type { Range } from './model';

export function blank(range: Range): Repair {
  return { kind: 'blank', range };
}

function insert(at: number, text: string): Repair {
  return { kind: 'insert', at, text };
}

/** The end of the line holding `position`, before trailing whitespace. */
function contentEnd(source: string, position: number): number {
  let end = position;
  while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
    end++;
  }
  while (end > position && /\s/.test(source[end - 1]!)) {
    end--;
  }
  return end;
}

/** `position` moved back over whitespace, not before `floor`. */
function trimBack(source: string, position: number, floor: number): number {
  while (position > floor && /\s/.test(source[position - 1]!)) {
    position--;
  }
  return position;
}

function unique(repairs: Repair[]): Repair[] {
  return repairs.filter((repair, index) => repair.kind !== 'insert'
    || !repairs.slice(0, index).some((other) => other.kind === 'insert' && other.at === repair.at));
}

/**
 * A missing closer for an attribute delimiter opened at `open`, such as the `)`
 * of `title=("Remove " + task.ti`: before the tag end when the line ends the tag
 * (`/>` or `>`), then at the end of the line.
 */
export function closeAttributeValue(source: string, open: number, text: string): Repair[] {
  const end = contentEnd(source, open);
  const repairs: Repair[] = [];
  for (const tagEnd of ['/>', '>']) {
    if (end - tagEnd.length > open && source.slice(end - tagEnd.length, end) === tagEnd) {
      repairs.push(insert(trimBack(source, end - tagEnd.length, open + 1), text));
      break;
    }
  }
  repairs.push(insert(end, text));
  return unique(repairs);
}

/**
 * A missing closing quote for a child string opened at `quote`: before the first
 * closing tag after it on the line (`<h2>"Nothing here</h2>`), then at the end
 * of the line.
 */
export function closeChildString(source: string, quote: number): Repair[] {
  const end = contentEnd(source, quote);
  const text = source[quote]!;
  const repairs: Repair[] = [];
  const closing = source.indexOf('</', quote + 1);
  if (closing > quote && closing < end) {
    repairs.push(insert(closing, text));
  }
  repairs.push(insert(end, text));
  return unique(repairs);
}
