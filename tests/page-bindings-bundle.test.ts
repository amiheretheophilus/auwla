import { resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'bun:test';
import { compileServerPage } from '../packages/compiler/src/page-compiler';

for (const graph of ['source', 'package'] as const) {
  it(`tree-shakes unused runtime capabilities from ${graph} server-page bindings`, async () => {
    const compiled = compileServerPage({ './page.tsx': `export function Page(inputs){
      const name=inputs[0];let count=0;
      return <section><h1>{name}</h1><button onClick={async()=>{await Promise.resolve();count++}}>Count {count}</button></section>;
    }` }, './page.tsx', 'Page', 1);
    expect(compiled.delivery.browser).toBe('bindings');
    const result = await build({
      stdin: { contents: compiled.browser['./page.tsx']!, loader: 'js', resolveDir: resolve(import.meta.dirname, '..') },
      alias: graph === 'source' ? { '@memoized-dom/runtime': resolve(import.meta.dirname, '../packages/runtime/src/index.ts') } : undefined,
      bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', minify: true,
    });
    const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
      .filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path.replaceAll('\\', '/'));
    for (const feature of ['list', 'list-positional', 'list-update', 'list-dom', 'list-keys', 'access', 'effect', 'dom-props']) {
      expect(inputs.some(path => path.endsWith(`/${feature}.ts`) || path.endsWith(`/${feature}.js`))).toBe(false);
    }
    expect(inputs.some(path => /\/(?:src|dist)\/page-bindings\.(?:ts|js)$/.test(path))).toBe(true);
    expect(result.outputFiles[0]!.text).not.toContain('Invalid structural list operation');
  });

  it(`retains list support when ${graph} server-page bindings actually use it`, async () => {
    const compiled = compileServerPage({ './page.tsx': `export function Page(inputs){
      const users=inputs[0];let open=false;
      return <div><button onClick={()=>open=!open}>Toggle {open}</button>{users.map(user=><p key={user.id}>{user.name}</p>)}</div>;
    }` }, './page.tsx', 'Page', 1);
    const result = await build({
      stdin: { contents: compiled.browser['./page.tsx']!, loader: 'js', resolveDir: resolve(import.meta.dirname, '..') },
      alias: graph === 'source' ? { '@memoized-dom/runtime': resolve(import.meta.dirname, '../packages/runtime/src/index.ts') } : undefined,
      bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', minify: true,
    });
    const inputs = Object.entries(Object.values(result.metafile!.outputs)[0]!.inputs)
      .filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path.replaceAll('\\', '/'));
    expect(inputs.some(path => /\/(?:src|dist)\/list\.(?:ts|js)$/.test(path))).toBe(true);
  });
}
