import { expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModules } from '@memoized-dom/compiler';
import { render, renderToReadableStream } from '@memoized-dom/server';
import type { FetchStub } from '../test-support/helpers';

// Conduit's article page for a missing slug: the request fails, and the
// server renders the Group's error policy instead of failing the page.
const SOURCES = [
  ['a local source', '', "const article = $fetch<{ title: string }>('/api/article');"],
  ['a module source', "import { article } from './article';", ''],
  // A live server function (its generated facade); the server reads one snapshot.
  ['a live server function', "import { getArticle } from './api';", 'const article = getArticle();'],
] as const;
// Where the page reads the failed source: a text child, an attribute, or a
// child component given the source (Conduit's AuthorLine).
const READS = {
  text: '<h1>{article.title}</h1>',
  attribute: '<a href={"/article/" + article.slug}>open</a>',
  'source prop': '<Author article={article} />',
};
// Buffered and streamed delivery, with and without planned initial content.
const cases = SOURCES.flatMap(([name, imports, local]) => Object.entries(READS).flatMap(([read, markup]) =>
  (['buffered', 'streamed'] as const).flatMap(delivery => [false, true].map(initial =>
    [`${name}, ${read}, ${delivery}${initial ? ', planned' : ''}`, imports, local, markup, delivery, initial] as const))));

it.each(cases)('a server render shows the error policy for a failed request (%s)', async (name, imports, local, markup, delivery, initial) => {
  const output = compileModules({
    './api.ts': "import { createStreamingSource } from '@memoized-dom/data/internal'; export function getArticle() { return createStreamingSource<{ title: string }>('/api/article', {}, 'live'); }",
    './article.ts': "import { $fetch } from '@memoized-dom/data'; export const article = $fetch<{ title: string }>('/api/article');",
    './app.tsx': `import { $fetch, Group } from '@memoized-dom/data'; ${imports}
      function Missing({ error }: { error: Error }) { return <h1 class="missing">{error.message}</h1>; }
      function Author({ article }: { article: { slug: string } }) { return <a href={"/profile/" + article.slug}>by</a>; }
      export function Main() { ${local}
        return <main><Group pending={() => <p>loading</p>} error={Missing}>${markup}</Group></main>; }`,
    './main.ts': "import { mount } from '@memoized-dom/runtime'; import { Main } from './app'; mount('root', Main);",
  }, { moduleStateCells: true, routedEnvironment: "server", initialContent: initial });
  const directory = join(import.meta.dirname, 'fixtures/out/ssr-group-error', name.replace(/\W+/g, '-'));
  for (const [file, code] of Object.entries(output)) {
    mkdirSync(join(directory, file, '..'), { recursive: true });
    writeFileSync(join(directory, file), code);
  }
  const { Main } = await import(pathToFileURL(join(directory, 'app.tsx')).href);
  const fetch = (() => Promise.resolve(Response.json({ message: "Article not found" }, { status: 404 }))) as FetchStub;
  const html = delivery === 'buffered'
    ? (await render(Main, { mode: 'resolve', fetch })).html
    : await new Response(renderToReadableStream(Main, { mode: 'resolve', fetch })).text();
  expect(html).toContain('<h1 class="missing">Article not found</h1>');
});
