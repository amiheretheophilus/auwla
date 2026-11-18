/** Route types (`declarations.ts`): the patterns a build reports, and the `.d.ts` made from them. */
import { describe, expect, it } from 'bun:test';
import { compileModulesDetailed } from '../../pipeline';
import { routeDeclarations } from './declarations';

describe('route types', () => {
  it('reports every full pattern, joined through components and nested routes, once each', () => {
    const compiled = compileModulesDetailed({
      './Profile.tsx': `export function Profile() {
        return <section><p route="/">Overview</p><p route="/posts/:post">Post</p></section>;
      }`,
      './App.tsx': `import { Profile } from './Profile';
        export function App() {
          return <main><p route="/">Home</p><Profile route="/profile/:name" /><p route="/*">Missing</p></main>;
        }`,
    });

    expect(compiled.routes).toEqual(['/', '/*', '/profile/:name', '/profile/:name/posts/:post']);
  });

  it('reports no patterns for a program without routes', () => {
    const compiled = compileModulesDetailed({ './App.tsx': 'export function App() { return <main>Hi</main>; }' });
    expect(compiled.routes).toBeUndefined();
  });

  it('types each pattern with what a link takes and what the router reads back', () => {
    const text = routeDeclarations(['/profile/:name', '/', '/files/*', '/'])!;

    expect(text).toContain("declare module '@memoized-dom/router'");
    expect(text).toContain('"/": { input: {}; params: {}; };');
    expect(text).toContain('"/profile/:name": { input: { "name": string | number | boolean | bigint }; params: { "name": string }; };');
    expect(text).toContain('"/files/*": { input: { "*": string | number | boolean | bigint }; params: { "*": string }; };');
    // Sorted, and once each, so an unchanged app writes the same file.
    expect(text.indexOf('"/"')).toBeLessThan(text.indexOf('"/files/*"'));
    expect(text.match(/"\/": /g)).toHaveLength(1);
  });

  it('makes no file for an app without routes', () => {
    expect(routeDeclarations([])).toBeNull();
  });
});
