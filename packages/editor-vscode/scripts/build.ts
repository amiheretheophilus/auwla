import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseRawGrammar } from 'vscode-textmate';
import { createAuwlaGrammar } from '@memoized-dom/jsx-plus/editor/grammar';

const packageRoot = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(packageRoot, 'dist');
const sharedAssets = resolve(packageRoot, '../jsx-plus/editor-assets');

await mkdir(outputDirectory, { recursive: true });
const build = await Bun.build({
  entrypoints: [resolve(packageRoot, 'src/extension.ts')],
  outdir: outputDirectory,
  naming: 'extension.cjs',
  target: 'node',
  format: 'cjs',
  external: ['vscode'],
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
