import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const root = join(import.meta.dirname, '..'), output = join(root, 'dist');
const require = createRequire(import.meta.url);
await mkdir(join(output, 'fonts'), { recursive: true });
await copyFile(join(root, 'src/inspector.css'), join(output, 'inspector.css'));
await copyFile(join(root, 'src/fonts.css'), join(output, 'fonts.css'));
for (const name of ['geist', 'geist-mono']) {
  const source = dirname(require.resolve(`@fontsource-variable/${name}/package.json`));
  await copyFile(join(source, `files/${name}-latin-wght-normal.woff2`), join(output, `fonts/${name}-latin-wght-normal.woff2`));
  await copyFile(join(source, 'LICENSE'), join(output, `fonts/${name}-LICENSE.txt`));
}
