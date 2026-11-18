/**
 * The layout rules of `wiki/compiler/README.md`, checked so the structure
 * cannot drift unnoticed: every source file is mapped on a wiki page, and
 * features never import each other.
 */
import { expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const source = import.meta.dirname;
const wiki = join(source, '../../../wiki/compiler');

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    if (statSync(path).isDirectory()) {
      return filesUnder(path);
    }

    return name.endsWith('.ts') ? [relative(source, path).replaceAll('\\', '/')] : [];
  });
}

const files = filesUnder(source);
const sources = files.filter((file) => !file.endsWith('.test.ts'));
const pages = readdirSync(wiki)
  .filter((name) => name.endsWith('.md'))
  .map((name) => readFileSync(join(wiki, name), 'utf8'));
const allPages = pages.join('\n');

/** The folders a page declares in its `**Folder:**` / `**Folders:**` paragraph. */
function declaredFolders(page: string): string[] {
  const start = page.search(/\*\*Folders?:\*\*/);

  if (start === -1) {
    return [];
  }

  const paragraph = page.slice(start).split(/\r?\n\s*\r?\n/)[0]!;

  return [...paragraph.matchAll(/`([^`]+\/)`/g)].map((match) => match[1]!);
}

/**
 * A page names a file by its path from `src/` or by its folder and name
 * (`emit/sites.ts`); a page that declares the file's folder may use the bare
 * name (`` `dom.ts` ``); a name no other file shares may appear anywhere.
 */
function mapped(file: string): boolean {
  const name = basename(file);
  const folder = `${dirname(file)}/`;
  const unique = sources.filter((other) => basename(other) === name).length === 1;
  const onFolderPage = pages.some((page) => declaredFolders(page).includes(folder) && page.includes(`\`${name}\``));

  return allPages.includes(file)
    || allPages.includes(`${basename(dirname(file))}/${name}`)
    || onFolderPage
    || (unique && allPages.includes(`\`${name}\``));
}

it('every compiler source file appears on a wiki page', () => {
  expect(sources.filter((file) => !mapped(file))).toEqual([]);
});

it('a feature imports core, never another feature', () => {
  const crossings: string[] = [];

  for (const file of files.filter((path) => path.startsWith('features/'))) {
    const feature = file.split('/')[1]!;
    const text = readFileSync(join(source, file), 'utf8');

    for (const match of text.matchAll(/from '([^']+)'/g)) {
      const target = match[1]!;

      if (!target.startsWith('.')) {
        continue;
      }

      const resolved = relative(source, join(source, dirname(file), target)).replaceAll('\\', '/');

      if (resolved.startsWith('features/') && resolved.split('/')[1] !== feature) {
        crossings.push(`${file} → ${resolved}`);
      }
    }
  }

  expect(crossings).toEqual([]);
});
