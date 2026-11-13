/** The build-time page: written into a page's HTML when it cannot change, with its stylesheets. */
import { describe, expect, it } from 'bun:test';
import { createProject, type CompiledProject } from './project';
import type { ProjectHost } from './host';
import { initialPage } from './page';

function memoryHost(files: Record<string, string>): ProjectHost {
  return { readFile: (path) => files[path] };
}

async function built(files: Record<string, string>): Promise<CompiledProject> {
  const build = await createProject({ entries: ['./src/main.ts'], host: memoryHost(files) }).build();
  if (!build.ok) throw build.error;
  return build;
}

const SHELL = '<!doctype html><html><head><title>Page</title></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>';

/** A static page importing three stylesheets: the entry's, then the card's (a dependency), then the app's. */
const STATIC_APP = {
  './src/main.ts': `import './base.css';\nimport { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
  './src/App.tsx': `import { Card } from './Card';\nimport './app.css';\nexport function App() { return <main><Card title="Hello" /></main>; }\n`,
  './src/Card.tsx': `import './card.css';\nexport function Card({ title }: { title: string }) { return <h1>{title}</h1>; }\n`,
};

describe('the build-time page', () => {
  it('lists the stylesheets the program imports, in the order a browser applies them', async () => {
    const build = await built(STATIC_APP);
    expect(build.stylesheets).toEqual(['./src/base.css', './src/card.css', './src/app.css']);
  });

  it('writes a page that cannot change into its HTML, with no script and its stylesheets linked', async () => {
    const build = await built(STATIC_APP);
    expect(build.initialRender.kind).toBe('html');
    const page = initialPage(SHELL, './index.html', build);

    expect(page).not.toBeNull();
    expect(page).toContain('<div id="root"><main><h1>Hello</h1></main></div>');
    expect(page).not.toContain('<script');
    expect(page).toContain('<link rel="stylesheet" href="./src/base.css">\n<link rel="stylesheet" href="./src/card.css">\n<link rel="stylesheet" href="./src/app.css">');
    // The rest of the file is kept as written.
    expect(page!.startsWith('<!doctype html><html><head><title>Page</title></head><body>')).toBe(true);
  });

  it('finds the entry from a script src relative to the page', async () => {
    const build = await built(STATIC_APP);
    const relative = SHELL.replace('src="/src/main.ts"', 'src="src/main.ts"');
    expect(initialPage(relative, './index.html', build)).toContain('<h1>Hello</h1>');
  });

  it('leaves an interactive page to its browser program', async () => {
    const build = await built({
      './src/main.ts': `import { mount } from '@memoized-dom/runtime';\nimport { App } from './App';\nmount('root', App);\n`,
      './src/App.tsx': `export function App() { let count = 0; return <button onClick={() => count++}>{count}</button>; }\n`,
    });
    expect(build.initialRender.kind).toBe('browser');
    expect(initialPage(SHELL, './index.html', build)).toBeNull();
  });

  it('leaves a page reading a CSS module to the browser: its class names are the bundler\'s', async () => {
    const build = await built({
      ...STATIC_APP,
      './src/Card.tsx': `import styles from './card.module.css';\nexport function Card({ title }: { title: string }) { return <h1 class={styles.title}>{title}</h1>; }\n`,
    });
    expect(build.initialRender.kind).toBe('browser');
  });

  it('leaves a shell it cannot rewrite safely alone', async () => {
    const build = await built(STATIC_APP);
    const cases = [
      SHELL.replace('</body>', '<script>window.x = 1</script></body>'),
      SHELL.replace('<div id="root"></div>', '<div id="root">loading</div>'),
      SHELL.replace('<div id="root"></div>', '<section><div id="root"></div></section>'),
      SHELL.replace('src="/src/main.ts"', 'src="/src/other.ts"'),
      SHELL.replace('src="/src/main.ts"', 'src="/src/main.ts?v=1"'),
      SHELL.replace('<head>', '<head><base href="/app/">'),
      SHELL.replace('<div id="root"></div>', '<div id="root"/>'),
    ];
    for (const shell of cases) expect(initialPage(shell, './index.html', build)).toBeNull();
  });
});
