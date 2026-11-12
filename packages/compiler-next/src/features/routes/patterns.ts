/**
 * Route patterns as the compiler checks them (`wiki/compiler/routes.md`, "Patterns"). Matching
 * itself belongs to the router (`packages/router/src/path.ts`); these are the rules a pattern
 * written in `route="…"` or `route-to` must follow before it gets there.
 */

const PARAMETER = /^:([A-Za-z_$][A-Za-z0-9_$]*)$/;

/** A pattern's segments, without empty ones. */
function segments(pattern: string): string[] {
  return pattern.split('/').filter(Boolean);
}

/**
 * The pattern, normalized (no trailing `/` except the root), or the reason it is not one:
 * it starts with `/`, has no query, hash or empty segment, a `*` only at the end, and each
 * `:name` once.
 */
export function checkPattern(pattern: string): { pattern: string } | { error: string } {
  if (!pattern.startsWith('/')) return { error: `route pattern '${pattern}' must begin with '/'` };
  if (pattern.includes('?') || pattern.includes('#')) return { error: `route pattern '${pattern}' must not contain a query or hash` };
  if (pattern.includes('//')) return { error: `route pattern '${pattern}' contains an empty path segment` };

  const trimmed = pattern.replace(/\/+$/, '');
  const normalized = trimmed === '' ? '/' : trimmed;
  const names = new Set<string>();
  const parts = segments(normalized);

  for (const [index, segment] of parts.entries()) {
    if (segment === '*') {
      if (index !== parts.length - 1) return { error: `route wildcard must be terminal in '${pattern}'` };
      continue;
    }
    if (!segment.startsWith(':')) continue;
    const match = PARAMETER.exec(segment);
    if (match === null) return { error: `invalid route parameter segment '${segment}' in '${pattern}'` };
    if (names.has(match[1]!)) return { error: `duplicate route parameter '${match[1]}' in '${pattern}'` };
    names.add(match[1]!);
  }

  return { pattern: normalized };
}

/** The parameter names a pattern captures, `*` included, in order. */
export function parameterNames(pattern: string): string[] {
  return segments(pattern).flatMap((segment) => {
    if (segment === '*') return ['*'];
    return segment.startsWith(':') ? [segment.slice(1)] : [];
  });
}

/** A child pattern under its parent's full pattern: `/` is the parent's own path. */
export function joinPatterns(parent: string, child: string): string {
  if (child === '/') return parent;
  return parent === '/' ? child : `${parent}${child}`;
}

/** Whether a pattern ends in a catch-all, which can have no child routes. */
export function isCatchAll(pattern: string): boolean {
  return pattern === '/*' || pattern.endsWith('/*');
}

/** The shape two patterns share when the router could not tell them apart (`/a/:x`, `/a/:y`). */
export function signatureOf(pattern: string): string {
  return `/${segments(pattern).map((segment) => {
    if (segment === '*') return '*';
    return segment.startsWith(':') ? ':param' : segment;
  }).join('/')}`;
}
