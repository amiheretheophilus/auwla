import { childExpression } from '../host';
import { copied, generated } from '../source';
import type { Replacement } from '../source';

/** Read a single delimited identifier; the host parser validates its spelling. */
export function identifierAttribute(source: string, afterEquals: number): Replacement | null {
  let start = afterEquals;
  while (start < source.length && /\s/.test(source[start]!)) {
    start++;
  }

  // Existing string/container values and the parenthesized form have readers
  // of their own. Keep the common path free of another host parse.
  if (start === source.length || ['"', "'", '{', '(', '<', '/'].includes(source[start]!)) {
    return null;
  }

  let end = start;
  while (end < source.length && !/[\s/>]/.test(source[end]!)) {
    end++;
  }
  const boundary = source[end];
  const delimited = boundary !== undefined
    && (/\s/.test(boundary) || boundary === '>' || source.startsWith('/>', end));
  if (!delimited || start === end) {
    return null;
  }

  const parsed = childExpression(source.slice(start, end));
  if (parsed.expression?.type !== 'Identifier'
    || parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return null;
  }

  return { start, end, pieces: [generated('{'), copied(source, start, end), generated('}')] };
}

/** Remove the assignment in the parser-only tag, leaving a boolean attribute. */
export function maskIdentifierAssignment(source: string, start: number, end: number): string {
  return source.slice(0, start)
    + source.slice(start, end).replace(/[^\r\n]/g, ' ') + source.slice(end);
}
