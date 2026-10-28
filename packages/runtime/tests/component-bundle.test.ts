/** Root-only adapters must not retain opaque mounting; dynamic tags still need it. */
import { expect, it } from 'bun:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

it.each([
  {
    name: 'a root-only callable adapter',
    source: `
      import { defineComponent, componentValue } from './packages/runtime/src/components';
      import { mount } from './packages/runtime/src/mount';
      function Root() { return document.createElement('main'); }
      defineComponent(Root, 'root');
      mount('root', componentValue(Root));
    `,
    opaque: false,
  },
  {
    name: 'an opaque component tag',
    source: `
      import { createComponentValue } from './packages/runtime/src/components';
      globalThis.rendered = createComponentValue(globalThis.unknownTag, {});
    `,
    opaque: true,
  },
])('retains opaque mounting only when required by $name', async ({ source, opaque }) => {
  const result = await build({
    stdin: { contents: source, resolveDir: resolve(import.meta.dirname, '../../..') },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const code = result.outputFiles[0]!.text;

  // These anchors belong to the generic value/list renderer, not the metadata
  // needed to create an adapted value. Keep that capability out of root graphs.
  expect(code.includes('mmd:value')).toBe(opaque);
  expect(code.includes('mmd:list')).toBe(opaque);
});
