import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { parseRawGrammar } from 'vscode-textmate';
import { createAuwlaGrammar } from '@memoized-dom/jsx-plus/editor/grammar';

const packageRoot = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(packageRoot, 'dist');
const sharedAssets = resolve(packageRoot, '../jsx-plus/editor-assets');
const require = createRequire(import.meta.url);

await mkdir(outputDirectory, { recursive: true });
const build = await Bun.build({
  entrypoints: [resolve(packageRoot, 'src/extension.ts')],
  outdir: outputDirectory,
  naming: 'extension.cjs',
  target: 'node',
  format: 'cjs',
  external: ['vscode'],
  plugins: [{
    name: 'css-service-esm',
    setup(builder) {
      // The package's CommonJS entry is UMD: its wrapper hides child requires
      // from the bundler. Resolve the supplied ESM entry for a complete bundle.
      builder.onResolve({ filter: /^vscode-css-languageservice$/ }, () => ({
        path: require.resolve('vscode-css-languageservice/lib/esm/cssLanguageService.js'),
      }));
    },
  }],
  minify: false,
});
if (!build.success) {
  throw new AggregateError(build.logs, 'VS Code adapter build failed');
}

const tsxPath = resolve(sharedAssets, 'vendor/TypeScriptReact.tmLanguage');
const grammar = createAuwlaGrammar(parseRawGrammar(await readFile(tsxPath, 'utf8'), tsxPath));
await writeFile(resolve(outputDirectory, 'auwla.tmLanguage.json'), JSON.stringify(grammar, null, 2) + '\n');
await copyFile(resolve(sharedAssets, 'language-configuration.json'), resolve(outputDirectory, 'language-configuration.json'));
await copyFile(resolve(sharedAssets, 'vendor/LICENSE.txt'), resolve(outputDirectory, 'TypeScript-TmLanguage-LICENSE.txt'));
console.log('Built the VS Code adapter and copied shared editor assets.');
