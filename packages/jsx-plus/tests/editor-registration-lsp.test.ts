import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMapperContribution } from '../src/editor/registration';
import { documentUri, withLanguageServer } from './lsp';
import { packageRoot, positionAt } from './rpc';

it('provides clean counter diagnostics, hover and authored errors after editor registration', async () => {
  const appsRoot = resolve(packageRoot, 'tests/fixtures/apps');
  const source = readFileSync(resolve(appsRoot, 'counter.auwla'), 'utf8');
  expect(source).not.toContain('@memoized-dom/compiler/jsx');
  const damaged = source.replace('{count}', '{count.toUpperCase()}');
  expect(damaged).toContain('count.toUpperCase()');
  const uri = documentUri(appsRoot, 'counter.auwla');
  const contribution = createMapperContribution(packageRoot);
  const manifest = contribution.inferredProjectContribution.manifest;

  await withLanguageServer(appsRoot, {}, async (server) => {
    // This is the real request sent by the TypeScript editor extension. Its
    // wire format serializes the URI's fsPath rather than sending a URI object.
    await server.request('custom/setContentMapperContributions', {
      contributions: [{
        contributorId: 'auwla-editor-test',
        extensions: contribution.extensions,
        inferredProjectContribution: {
          ...contribution.inferredProjectContribution,
          manifest: { ...manifest, cwd: manifest.cwd.fsPath },
        },
      }],
      openDocuments: [],
    });
    await server.show(uri, source);
    expect(await server.diagnostics(uri)).toEqual([]);
    await server.show(uri, damaged);
    const diagnostics = await server.diagnostics(uri);
    const method = damaged.indexOf('toUpperCase');
    expect(diagnostics.find((diagnostic) => diagnostic.code === 2339)?.range).toEqual({
      start: positionAt(damaged, method),
      end: positionAt(damaged, method + 'toUpperCase'.length),
    });
    const hover = await server.request<{ contents: { value: string } } | null>('textDocument/hover', {
      textDocument: { uri }, position: positionAt(damaged, damaged.indexOf('count =')),
    });
    expect(hover?.contents.value).toContain('count: number');
  });
}, 30000);
