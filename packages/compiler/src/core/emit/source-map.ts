/**
 * Source maps from output to the authored text (`wiki/compiler/project.md`, "Source maps").
 *
 * `yuku-codegen` maps each printed node to its offset in the text the analyzer read. That text is
 * the authored text after the compiler's own rewrites (TypeScript, slots, routes, `require`
 * imports), so each position is followed back through their `TextOrigin` to where the author
 * wrote it. A node the compiler built has no place in either text; the printer reports offset 0
 * for it, and here it becomes an unmapped segment, so the generated code around an authored
 * expression is not blamed on the first line of the file.
 */
import type { TextOrigin } from '../parse/text-edits';

export interface SourceMap {
  readonly version: 3;
  readonly file?: string;
  readonly sources: readonly string[];
  readonly sourcesContent: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

/** What a module's output maps back to. */
export interface MappedSource {
  readonly path: string;
  /** The text the analyzer read, which the printer's offsets are in. */
  readonly analyzed: string;
  readonly authored: string;
  readonly origin: TextOrigin;
}

/** The printer's mappings, moved from the analyzed text to the authored text. */
export function mapToAuthored(printed: string, source: MappedSource): SourceMap {
  const analyzedLines = lineStarts(source.analyzed);
  const authoredLines = lineStarts(source.authored);

  const lines = decodeMappings(printed).map((segments) => segments.map((segment): Segment => {
    if (segment.length < 4) return [segment[0]!];
    const offset = analyzedLines[segment[2]!]! + segment[3]!;
    if (offset === 0) return [segment[0]!];
    const authored = source.origin.original(offset);
    const line = lineAt(authoredLines, authored);
    return [segment[0]!, 0, line, authored - authoredLines[line]!];
  }));

  return {
    version: 3,
    sources: [source.path],
    sourcesContent: [source.authored],
    names: [],
    mappings: encodeMappings(lines),
  };
}

// ---------------------------------------------------------------------------
// Lines

/** The offset each line starts at. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

/** The line holding `offset`. */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

// ---------------------------------------------------------------------------
// Mappings: lines split by `;`, segments by `,`, each a list of base64 VLQ numbers. A segment is
// [output column, source, line, column, name?]; the column restarts each line, the rest are
// relative to the segment before across the whole map.

/** A decoded segment with absolute values: one field (unmapped), or four. */
type Segment = number[];

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGITS = new Map([...BASE64].map((character, index) => [character, index]));

function decodeMappings(mappings: string): Segment[][] {
  const fields = [0, 0, 0, 0, 0];
  return mappings.split(';').map((line) => {
    fields[0] = 0;
    if (line === '') return [];
    return line.split(',').map((text) => {
      const values = decodeVlq(text);
      return values.map((value, index) => (fields[index]! += value));
    });
  });
}

function encodeMappings(lines: readonly Segment[][]): string {
  const previous = [0, 0, 0, 0];
  return lines.map((segments) => {
    previous[0] = 0;
    return segments.map((segment) => segment.map((value, index) => {
      const delta = value - previous[index]!;
      previous[index] = value;
      return encodeVlq(delta);
    }).join('')).join(',');
  }).join(';');
}

function decodeVlq(text: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of text) {
    const digit = DIGITS.get(character)!;
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    // The lowest bit is the sign.
    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return values;
}

function encodeVlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let text = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    text += BASE64[digit];
  } while (rest > 0);
  return text;
}
