/**
 * `.memoized/routes.d.ts` (`wiki/compiler/routes.md`, "Route types"): the app's route patterns as
 * the router's `RouteTable`, so TypeScript checks `route-to` and `navigate` against the routes the
 * app really has, with each pattern's parameters. Every tool writes this text as it is
 * (`wiki/rules.md`, rule 17), so it is made here once.
 */
import { parameterNames } from './patterns';

/** The declaration file for these full patterns, or null when the app has no routes. */
export function routeDeclarations(patterns: readonly string[]): string | null {
  if (patterns.length === 0) {
    return null;
  }

  const entries = [...new Set(patterns)].sort().map(routeEntry).join('\n');
  return `declare module '@memoized-dom/router' {
  interface RouteTable {
${entries}
  }
}

export {};
`;
}

/**
 * One pattern's entry: what building a link to it takes (`input`, any value a URL can show) and
 * what the router reads back from it (`params`, always text).
 */
function routeEntry(pattern: string): string {
  const names = parameterNames(pattern);
  const input = shape(names, 'string | number | boolean | bigint');
  const params = shape(names, 'string');
  return `    ${JSON.stringify(pattern)}: { input: ${input}; params: ${params}; };`;
}

function shape(names: readonly string[], type: string): string {
  if (names.length === 0) {
    return '{}';
  }
  return `{ ${names.map((name) => `${JSON.stringify(name)}: ${type}`).join('; ')} }`;
}
