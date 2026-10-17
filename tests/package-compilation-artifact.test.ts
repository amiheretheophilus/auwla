import { describe, expect, it, vi } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import {
  analyzeServerFunctionModule,
  compileModulesDetailed,
  definePackageBoundaries,
  emitInitialHtml,
  experimentalPackageArtifactInstance,
  experimentalCompilePackage,
  generateServerFunctionClient,
  validateExperimentalPackageArtifact,
  type ExperimentalPackageArtifact,
} from '@memoized-dom/compiler';
import { createDataRuntime, setActiveDataRuntime } from '@memoized-dom/data';
import { registerRootFactory, unregister } from '@memoized-dom/runtime';
import { mountInitial } from '@memoized-dom/runtime/testing';
import { renderToString } from '@memoized-dom/server';
import { waitFor } from '../test-support/helpers';
import { utilsPackageArtifact } from '../test-support/package-artifacts';

const outDir = join(
  import.meta.dirname,
  'fixtures',
  'out',
  'package-compilation-artifact',
);

describe('experimental package compilation artifacts', () => {
  it('builds opaque runtime-boundary artifacts from the compact authoring form', () => {
    expect(definePackageBoundaries({
      'runtime-package/internal': {
        holdSource: {
          source: [0, { argument: 1, path: ['nested'] }],
          writes: [{ argument: 2, path: ['value'] }],
        },
      },
    })).toEqual({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'runtime-package/internal': {
          functions: {
            holdSource: {
              parameterWrites: [{ index: 2, path: ['value'] }],
              parameterSourceReads: [
                { index: 0, path: [] },
                { index: 1, path: ['nested'] },
              ],
              parameterPayloadReads: [],
              unbounded: false,
            },
          },
        },
      },
    });
    expect(() => definePackageBoundaries({
      bad: { helper: { source: [-1] } },
    })).toThrow('must be a non-negative integer');
  });

  it('rejects incompatible and malformed package artifacts at the boundary', () => {
    expect(() => validateExperimentalPackageArtifact({
      kind: 'memoized-dom-package',
      version: 2,
      entries: {},
    })).toThrow('artifact.version; expected format version 1');

    expect(() => validateExperimentalPackageArtifact({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'broken-package': {
          functions: {
            pending: {
              parameterWrites: [],
              parameterSourceReads: [{ index: 'first', path: [] }],
              parameterPayloadReads: [],
              unbounded: false,
            },
          },
        },
      },
    })).toThrow(
      'artifact.entries["broken-package"].functions["pending"].parameterSourceReads[0].index; expected a non-negative integer',
    );

    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { Badge } from 'broken-package';
        export function App() { return <Badge />; }
      `,
    }, {
      experimentalPackageArtifacts: [{
        kind: 'memoized-dom-package',
        version: 1,
        entries: {
          'broken-package': {
            functions: {},
            components: { Badge: { key: 'package:broken-package#Badge' } },
          },
        },
      } as ExperimentalPackageArtifact],
    })).toThrow(
      'artifact.entries["broken-package"].components["Badge"].props; expected an array of strings',
    );
  });

  it('returns authored source maps with precompiled package output', () => {
    const source = `
      export function PackageBadge({ label }: { label: string }) {
        return <strong>{label}</strong>;
      }
    `;
    const packaged = experimentalCompilePackage({
      '../src/index.tsx': source,
    }, {
      packageEntries: { 'mapped-package': '../src/index.tsx' },
    });
    const code = packaged.output['../src/index.tsx']!;
    const lines = code.split('\n');
    const generatedLine = lines.findIndex(line =>
      line.includes('createElement("strong")'),
    ) + 1;
    const generatedColumn = lines[generatedLine - 1]!.indexOf('document');
    const map = packaged.maps['../src/index.tsx']!;

    expect(map.sources).toEqual(['../src/index.tsx']);
    expect(map.sourcesContent).toEqual([source]);
    expect(originalPositionFor(new TraceMap(map), {
      line: generatedLine,
      column: generatedColumn,
    })).toMatchObject({
      source: '../src/index.tsx',
      line: 3,
    });
  });

  it('specializes static package DOM, scalar props, and slots into initial HTML', () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        export function Card({ title, name }: { title: string; name: string }) {
          return <article data-card title={title}>Hello {name}<slot><i>Fallback</i></slot></article>;
        }
        export function Interactive() {
          let count = 0;
          return <button onClick={() => count++}>{count}</button>;
        }
      `,
    }, {
      packageEntries: { 'initial-package': './index.tsx' },
    });
    const components = packaged.artifact.entries['initial-package']!.components!;
    expect(components.Card.initial).toBeDefined();
    expect(components.Interactive.initial).toBeUndefined();

    const emptySiteArtifact = structuredClone(packaged.artifact);
    const emptySite = emptySiteArtifact.entries['initial-package']!.components!.Card.initial!;
    if (emptySite.root.kind !== 'element') throw new Error('expected a package host root');
    Reflect.set(emptySite.root, 'site', '');
    expect(() => validateExperimentalPackageArtifact(emptySiteArtifact)).toThrow(
      '.initial.root.site; expected a non-empty string',
    );

    const nonFiniteArtifact = structuredClone(packaged.artifact);
    const nonFinite = nonFiniteArtifact.entries['initial-package']!.components!.Card.initial!;
    if (nonFinite.root.kind !== 'element') throw new Error('expected a package host root');
    Reflect.set(nonFinite.root.attributes[0]!.value, 'value', Number.POSITIVE_INFINITY);
    expect(() => validateExperimentalPackageArtifact(nonFiniteArtifact)).toThrow(
      '.initial.root.attributes[0].value.value; expected a finite JSON number',
    );

    const directiveArtifact = structuredClone(packaged.artifact);
    const directive = directiveArtifact.entries['initial-package']!.components!.Card.initial!;
    if (directive.root.kind !== 'element') throw new Error('expected a package host root');
    Reflect.set(directive.root.attributes[0]!, 'name', 'onClick');
    expect(() => validateExperimentalPackageArtifact(directiveArtifact)).toThrow(
      '.initial.root.attributes[0].name; expected a static platform attribute',
    );

    const storedArtifact = JSON.parse(JSON.stringify(packaged.artifact)) as ExperimentalPackageArtifact;

    const application = compileModulesDetailed({
      './main.ts': `
        import { mount } from '@memoized-dom/runtime';
        import { App } from './app';
        mount('root', App);
      `,
      './app.tsx': `
        import { Card } from 'initial-package';
        export function App() {
          return <main>
            <Card title={'A & B'} name="Ada"><strong>Projected</strong></Card>
            <Card title="Second" name="Grace" />
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [storedArtifact],
      initialContent: true,
    });

    expect(application.initialRender.kind).toBe('html');
    expect(emitInitialHtml(application.initialRender)).toBe(
      '<main><article data-card="true" title="A &amp; B">Hello Ada<strong>Projected</strong></article><article data-card="true" title="Second">Hello Grace<i>Fallback</i></article></main>',
    );

    const bound = compileModulesDetailed({
      './main.ts': `
        import { mount } from '@memoized-dom/runtime';
        import { App } from './app';
        mount('root', App);
      `,
      './app.tsx': `
        import { Card } from 'initial-package';
        export function App() {
          let count = 0;
          return <main>
            <button onClick={() => count++}>{count}</button>
            <Card title="Fixed" name="Ada"><strong>Projected</strong></Card>
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [storedArtifact],
      initialContent: true,
    });
    expect(bound.initialRender.kind).toBe('bindings');
    expect(bound.initialContent).toBe(true);
    expect(emitInitialHtml(bound.initialRender)).toContain(
      '<article data-card="true" title="Fixed">Hello Ada<strong>Projected</strong></article>',
    );
    expect(bound.output['./app.tsx']).not.toContain('Card("');

    const reactive = compileModulesDetailed({
      './main.ts': `
        import { mount } from '@memoized-dom/runtime';
        import { App } from './app';
        mount('root', App);
      `,
      './app.tsx': `
        import { Card } from 'initial-package';
        export function App() {
          let name = 'Ada';
          return <main>
            <button onClick={() => name = 'Grace'}>Rename</button>
            <Card title="Live" name={name} />
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [storedArtifact],
      initialContent: true,
    });
    expect(reactive.initialContent).toBe(false);
    expect(reactive.initialRender.kind).toBe('browser');
  });

  it('keeps importer-resolved copies of one package specifier distinct', () => {
    const first = experimentalCompilePackage({
      './index.tsx': `
        export function Badge({ value }: { value: number }) {
          return <strong>{value}</strong>;
        }
      `,
    }, {
      packageEntries: { 'ui-package': './index.tsx' },
    });
    const second = experimentalCompilePackage({
      './index.tsx': `
        export function Badge({ label }: { label: string }) {
          return <em>{label}</em>;
        }
      `,
    }, {
      packageEntries: { 'ui-package': './index.tsx' },
    });
    const firstInstance = experimentalPackageArtifactInstance(first.artifact);
    const secondInstance = experimentalPackageArtifactInstance(second.artifact);
    expect(firstInstance).not.toBe(secondInstance);

    const application = compileModulesDetailed({
      './first.tsx': `
        import { Badge } from 'ui-package';
        export function First() { return <Badge value={1} />; }
      `,
      './second.tsx': `
        import { Badge } from 'ui-package';
        export function Second() { return <Badge label="two" />; }
      `,
      './app.tsx': `
        import { First } from './first';
        import { Second } from './second';
        export function App() { return <main><First /><Second /></main>; }
      `,
    }, {
      experimentalPackageImports: [
        {
          importer: './first.tsx',
          specifier: 'ui-package',
          instance: firstInstance,
          artifact: first.artifact,
        },
        {
          importer: './second.tsx',
          specifier: 'ui-package',
          instance: secondInstance,
          artifact: second.artifact,
        },
      ],
    });

    expect(application.output['./first.tsx']).toContain('{ value: 1 }');
    expect(application.output['./second.tsx']).toContain('{ label: "two" }');
  });

  it('adopts reactive package props once and creates later package mounts', async () => {
    const runtimePath = '@memoized-dom/runtime/testing';
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        export function Card({ label, title }: { label: string; title: string }) {
          return <article data-reactive-card title={title}><h2>{label}</h2></article>;
        }
      `,
    }, { packageEntries: { 'adopted-package': './index.tsx' }, runtimePath });
    expect(packaged.artifact.entries['adopted-package']!.components!.Card.initial?.adoption)
      .toBe('host-v1');
    const application = compileModulesDetailed({
      './main.ts': `import { mount } from '${runtimePath}'; import { App } from './app'; mount('root', App);`,
      './app.tsx': `
        import { Card } from 'adopted-package';
        export function App() {
          let label = 'Ada';
          let empty = '';
          let show = true;
          return <main>
            <button data-rename onClick={() => { label = 'Grace'; empty = 'Ready'; }}>Rename</button>
            <button data-toggle onClick={() => show = !show}>Toggle</button>
            <Card label={label} title={label} />
            <Card label={empty} title={label} />
            <Card label="Fixed" title="Fixed" />
            {show && <Card label={label} title="Branch" />}
          </main>;
        }
      `,
    }, { experimentalPackageArtifacts: [JSON.parse(JSON.stringify(packaged.artifact))], initialContent: true, runtimePath });
    expect(application.initialContent).toBe(true);
    expect(application.initialRender.kind).toBe('bindings');
    const directory = join(outDir, 'initial-adoption');
    const packageDirectory = join(directory, 'node_modules', 'adopted-package');
    mkdirSync(packageDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
    writeFileSync(join(packageDirectory, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(join(directory, 'app.js'), application.output['./app.tsx']!);
    document.body.innerHTML = `<div id="root">${emitInitialHtml(application.initialRender)}</div>`;
    const originals = [...document.querySelectorAll('article')];
    const create = vi.spyOn(document, 'createElement');
    let mounted: ReturnType<typeof mountInitial> | undefined;
    try {
      const { App } = await import(`${pathToFileURL(join(directory, 'app.js')).href}?adoption=${Date.now()}`);
      mounted = mountInitial('root', App);
      expect(create).not.toHaveBeenCalled();
      expect([...document.querySelectorAll('article')]).toEqual(originals);
      create.mockRestore();
      document.querySelector<HTMLButtonElement>('[data-rename]')!.click();
      await waitFor(() => {
        expect(originals.map(node => node.textContent)).toEqual(['Grace', 'Ready', 'Fixed', 'Grace']);
        expect(originals[0]!.title).toBe('Grace');
        expect(originals[1]!.title).toBe('Grace');
      });
      document.querySelector<HTMLButtonElement>('[data-toggle]')!.click();
      await waitFor(() => expect(document.querySelectorAll('article')).toHaveLength(3));
      document.querySelector<HTMLButtonElement>('[data-toggle]')!.click();
      await waitFor(() => {
        const cards = [...document.querySelectorAll('article')];
        expect(cards).toHaveLength(4);
        expect(cards.slice(0, 3)).toEqual(originals.slice(0, 3));
        expect(cards[3]).not.toBe(originals[3]);
        expect(cards[3]!.textContent).toBe('Grace');
      });
    } finally {
      create.mockRestore();
      mounted?.unmount();
      document.body.replaceChildren();
    }
  });

  it('keeps ordinary creation when a package has no compatible adoption path', () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        export function Badge({ label }: { label: string }) { return <b>{label}</b>; }
        export function Panel() { return <section><slot><i>Fallback</i></slot></section>; }
      `,
    }, { packageEntries: { 'older-ui': './index.tsx' } });
    const oldArtifact = structuredClone(packaged.artifact);
    Reflect.deleteProperty(oldArtifact.entries['older-ui']!.components!.Badge.initial!, 'adoption');
    const compile = (body: string, artifact = packaged.artifact) => compileModulesDetailed({
      './main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './app'; mount('root', App);`,
      './app.tsx': `import {Badge, Panel} from 'older-ui'; export function App() { ${body} }`,
    }, { initialContent: true, experimentalPackageArtifacts: [artifact] });
    expect(compile(`let label='Before'; return <main><Badge label={label}/><button onClick={()=>label='After'}>Change</button></main>;`, oldArtifact).initialContent)
      .toBe(false);
    expect(compile(`let show=false; return <main><Panel><b>Fixed</b></Panel><button onClick={()=>show=!show}>Toggle</button>{show&&<Panel><b>Later</b></Panel>}</main>;`).initialContent)
      .toBe(false);

    const unsupported = structuredClone(packaged.artifact);
    Reflect.set(unsupported.entries['older-ui']!.components!.Badge.initial!, 'adoption', 'host-v2');
    expect(() => validateExperimentalPackageArtifact(unsupported)).toThrow(".initial.adoption; expected 'host-v1', 'host-slots-v1', or 'host-events-v1'");
    const slotAdoption = structuredClone(packaged.artifact);
    Reflect.set(slotAdoption.entries['older-ui']!.components!.Panel.initial!, 'adoption', 'host-v1');
    expect(() => validateExperimentalPackageArtifact(slotAdoption)).toThrow('host-v1 does not support component slots');
  });

  it.each([false, true])('adopts dedicated package slots with caller-owned events and remounts (open=%s)', async open => {
    const runtimePath = '@memoized-dom/runtime/testing';
    const packaged = experimentalCompilePackage({
      './index.tsx': `export function Panel({title}:{title:string}) {
        return <section><h2>{title}</h2><header><slot name="heading"/></header>
          <main><slot/></main><footer>After</footer></section>;
      }`,
    }, {packageEntries: {'slotted-package': './index.tsx'}, runtimePath});
    expect(packaged.artifact.entries['slotted-package']!.components!.Panel.initial?.adoption).toBe('host-slots-v1');
    const application = compileModulesDetailed({
      './main.ts': `import {mount} from '${runtimePath}';import {App} from './app';mount('root',App);`,
      './app.tsx': `import {Panel} from 'slotted-package';export function App(){let n=1;let open=${open};
        return <div><button class="toggle" onClick={()=>open=!open}>Toggle</button>
          <button class="next" onClick={()=>n++}>Next</button>{open&&<Panel title={'Title '+n}>
            <button slot="heading" class="inside" onClick={()=>n++}>{n}</button>
            <b>{n}</b><input class="draft" placeholder="Draft"/>
          </Panel>}<p>{n}</p></div>;
      }`,
    }, {initialContent:true, experimentalPackageArtifacts:[JSON.parse(JSON.stringify(packaged.artifact))],runtimePath});
    expect(application.initialContent).toBe(true);
    expect(application.initialRender.kind).toBe('bindings');
    const directory = join(outDir, `slot-adoption-${open}`);
    const packageDirectory = join(directory, 'node_modules', 'slotted-package');
    mkdirSync(packageDirectory, {recursive:true});
    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({type:'module',exports:'./index.js'}));
    writeFileSync(join(packageDirectory, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(join(directory, 'app.js'), application.output['./app.tsx']!);
    document.body.innerHTML = `<div id="root">${emitInitialHtml(application.initialRender)}</div>`;
    const originals = [...document.querySelectorAll('*')];
    const create = vi.spyOn(document,'createElement');
    let mounted: ReturnType<typeof mountInitial> | undefined;
    const click = (selector:string) => document.querySelector<HTMLButtonElement>(selector)!.click();
    try {
      const {App} = await import(`${pathToFileURL(join(directory,'app.js')).href}?slots=${Date.now()}`);
      mounted = mountInitial('root',App);
      expect(create).not.toHaveBeenCalled();
      expect([...document.querySelectorAll('*')]).toEqual(originals);
      create.mockRestore();
      if (!open) {
        click('.toggle');
        await waitFor(() => expect(document.querySelectorAll('section').length).toBe(1));
      }
      const section = document.querySelector('section');
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.inside')];
      const draft = document.querySelector<HTMLInputElement>('.draft')!;
      draft.value = 'Keep my draft';
      buttons[0]!.click();
      await waitFor(() => {
        expect(buttons.map(node=>node.textContent)).toEqual(['2']);
        expect(document.querySelector('b')!.textContent).toBe('2');
        expect(document.querySelector('h2')!.textContent).toBe('Title 2');
      });
      expect(document.querySelector('section')).toBe(section);
      expect(document.querySelector('.draft')).toBe(draft);
      expect(draft.value).toBe('Keep my draft');
      click('.toggle');
      await waitFor(() => expect(document.querySelectorAll('section').length).toBe(0));
      click('.next');
      await waitFor(() => expect(document.querySelector('p')!.textContent).toBe('3'));
      click('.toggle');
      await waitFor(() => {
        expect([...document.querySelectorAll('.inside')].map(node=>node.textContent)).toEqual(['3']);
        expect(document.querySelector('b')!.textContent).toBe('3');
      });
      expect(document.querySelector('section')).not.toBe(section);
      document.querySelector<HTMLButtonElement>('.inside')!.click();
      await waitFor(() => expect([...document.querySelectorAll('.inside')].map(node=>node.textContent)).toEqual(['4']));
    } finally {
      create.mockRestore();mounted?.unmount();document.body.replaceChildren();
    }
  });

  it('rejects portable slot adoption without dedicated hosts or with fallbacks', () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `export function Mixed(){return <section><b>Before</b><slot/></section>;}
        export function Fallback(){return <section><main><slot><b>Empty</b></slot></main></section>;}`,
    }, {packageEntries:{'bounded-slots':'./index.tsx'}});
    for (const [name,component] of Object.entries(packaged.artifact.entries['bounded-slots']!.components!)) {
      expect(component.initial?.adoption).toBeUndefined();
      const artifact = structuredClone(packaged.artifact);
      Reflect.set(artifact.entries['bounded-slots']!.components![name]!.initial!, 'adoption','host-slots-v1');
      expect(()=>validateExperimentalPackageArtifact(artifact)).toThrow('requires dedicated slot hosts without fallbacks');
    }
  });

  it.each([0,2])('binds repeated package slots with distinct extents, lists and empty slots (rows=%s)', async count => {
    const runtimePath='@memoized-dom/runtime/testing';
    const packaged=experimentalCompilePackage({
      './index.tsx':`export function Panel({title}:{title:string}){return <section><h2>{title}</h2><header><slot name="heading"/></header><main><slot/></main><footer>After</footer></section>;}`,
    },{packageEntries:{'repeated-slots':'./index.tsx'},runtimePath});
    const application=compileModulesDetailed({
      './main.ts':`import {mount} from '${runtimePath}';import {App} from './app';mount('root',App);`,
      './app.tsx':`import {Panel} from 'repeated-slots';export function App(){let n=1;let shown=true;let rows=${JSON.stringify(Array.from({length:count},(_,id)=>({id,label:'row'+id})))};
        return <div><button class="reverse" onClick={()=>rows=rows.toReversed()}>Reverse</button>
          <button class="append" onClick={()=>rows=[...rows,{id:2,label:'new'}]}>Append</button>
          <button class="shown" onClick={()=>shown=!shown}>Shown</button>
          <Panel title={'First '+n}><button slot="heading" class="inside" onClick={()=>n++}>{n}</button>
            {shown&&<b>{n}</b>}{rows.map(row=><li key={row.id}>{row.label}:{n}</li>)}</Panel>
          <Panel title={'Second '+n}><i>{n}</i></Panel>
          <Panel title={'Empty '+n}/></div>;
      }`,
    },{initialContent:true,experimentalPackageArtifacts:[packaged.artifact],runtimePath});
    expect(application.initialContent).toBe(true);
    const directory=join(outDir,`repeated-slot-adoption-${count}`);
    const packageDirectory=join(directory,'node_modules','repeated-slots');
    mkdirSync(packageDirectory,{recursive:true});
    writeFileSync(join(packageDirectory,'package.json'),JSON.stringify({type:'module',exports:'./index.js'}));
    writeFileSync(join(packageDirectory,'index.js'),packaged.output['./index.tsx']!);
    writeFileSync(join(directory,'app.js'),application.output['./app.tsx']!);
    document.body.innerHTML=`<div id="root">${emitInitialHtml(application.initialRender)}</div>`;
    const originals=[...document.querySelectorAll('*')];
    const create=vi.spyOn(document,'createElement');
    let mounted:ReturnType<typeof mountInitial>|undefined;
    const click=(selector:string)=>document.querySelector<HTMLButtonElement>(selector)!.click();
    try {
      const {App}=await import(`${pathToFileURL(join(directory,'app.js')).href}?repeated=${Date.now()}`);
      mounted=mountInitial('root',App);
      expect(create).not.toHaveBeenCalled();
      const adopted=[...document.querySelectorAll('*')];
      expect(adopted.length).toBe(originals.length);
      expect(adopted.every((node,index)=>node===originals[index])).toBe(true);
      create.mockRestore();
      const rows=[...document.querySelectorAll('li')];
      click('.reverse');
      await waitFor(()=>{
        const current=[...document.querySelectorAll('li')];
        expect(current.length).toBe(rows.length);
        expect(current.every((node,index)=>node===rows.at(-index-1))).toBe(true);
      });
      click('.inside');
      await waitFor(()=>{
        expect([...document.querySelectorAll('h2')].map(node=>node.textContent)).toEqual(['First 2','Second 2','Empty 2']);
        expect(document.querySelector('b')!.textContent).toBe('2');expect(document.querySelector('i')!.textContent).toBe('2');
        expect([...document.querySelectorAll('li')].map(node=>node.textContent)).toEqual(
          Array.from({length:count},(_,index)=>`row${count-index-1}:2`));
      });
      click('.append');
      await waitFor(()=>expect(document.querySelectorAll('li').length).toBe(count+1));
      click('.shown');await waitFor(()=>expect(document.querySelectorAll('b').length).toBe(0));
      click('.shown');await waitFor(()=>expect(document.querySelector('b')?.textContent).toBe('2'));
      expect(originals.filter(node=>node.tagName==='SECTION').every(node=>node.isConnected)).toBe(true);
    } finally {
      create.mockRestore();mounted?.unmount();document.body.replaceChildren();
    }
  });

  it('links a separately compiled ordinary helper without its source', async () => {
    const packaged = experimentalCompilePackage({
      './index.ts': `
        import { $track } from '@memoized-dom/data';
        export function describe(source) {
          return $track(source).pending
            ? 'Loading'
            : source.length + ' stories';
        }
      `,
    }, {
      packageEntries: { 'some-package': './index.ts' },
      runtimePath: '@memoized-dom/runtime/testing',
    });

    expect(packaged.artifact).toEqual({
      kind: 'memoized-dom-package',
      version: 1,
      entries: {
        'some-package': {
          functions: {
            describe: expect.objectContaining({
              parameterSourceReads: [{ index: 0, path: [] }],
              parameterPayloadReads: [{ index: 0, path: [] }],
            }),
          },
        },
      },
    });
    expect(packaged.output['./index.ts']).toContain('_MDD.readResolvedValue(source');
    const storedArtifact = JSON.parse(
      JSON.stringify(packaged.artifact),
    ) as ExperimentalPackageArtifact;

    const application = compileModulesDetailed({
      './app.tsx': `
        import { describe as label } from 'some-package';
        export function PackageApp() {
          const stories = $fetch('/api/package-stories');
          return <p>{label(stories)}</p>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [storedArtifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    mkdirSync(join(outDir, 'node_modules', 'some-package'), { recursive: true });
    writeFileSync(
      join(outDir, 'node_modules', 'some-package', 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(
      join(outDir, 'node_modules', 'some-package', 'index.js'),
      packaged.output['./index.ts']!,
    );
    writeFileSync(join(outDir, 'app.js'), application.output['./app.tsx']!);

    const request = Promise.withResolvers<Response>();
    const data = createDataRuntime({ fetch: () => request.promise });
    const previous = setActiveDataRuntime(data);
    document.body.replaceChildren();
    try {
      const { PackageApp } = await import(
        `${pathToFileURL(join(outDir, 'app.js')).href}?runtime=${Date.now()}`
      );
      const paragraph = PackageApp('PackageArtifactApp', null) as HTMLParagraphElement;
      document.body.append(paragraph);
      expect(paragraph.textContent).toBe('Loading');

      request.resolve(Response.json([{ id: 1 }, { id: 2 }]));
      await waitFor(() => {
        expect(paragraph.textContent).toBe('2 stories');
      });
      expect(document.querySelector('p')).toBe(paragraph);
    } finally {
      unregister('PackageArtifactApp');
      data.clear();
      setActiveDataRuntime(previous);
      document.body.replaceChildren();
    }
  });

  it('rejects package-owned compiler state', () => {
    expect(() => experimentalCompilePackage({
      './index.tsx': `
        export let count = 0;
        export function increment() {
          return ++count;
        }
      `,
    }, {
      packageEntries: { 'some-components': './index.tsx' },
    })).toThrow('package state linking is not implemented');
  });

  it('rejects precompiled components which read package module state', () => {
    expect(() => experimentalCompilePackage({
      './index.tsx': `
        let count = 0;
        export function Counter() {
          return <button onClick={() => count++}>{count}</button>;
        }
      `,
    }, {
      packageEntries: { 'some-components': './index.tsx' },
    })).toThrow('components read package module state');
  });

  it('rejects package component identities not owned by their entry', () => {
    const artifact = structuredClone(experimentalCompilePackage({
      './index.tsx': `export function Badge() { return <b>Badge</b>; }`,
    }, {
      packageEntries: { 'bad-package': './index.tsx' },
    }).artifact);
    const badge = artifact.entries['bad-package']!.components!.Badge!;
    (badge as { key: string }).key = './app.tsx#App';
    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { Badge } from 'bad-package';
        export function App() { return <Badge />; }
      `,
    }, {
      experimentalPackageArtifacts: [artifact],
    })).toThrow("component 'bad-package' export 'Badge' has invalid key");
  });

  it('rejects a packaged component which claims the caller-only row ABI', () => {
    const artifact = structuredClone(experimentalCompilePackage({
      './index.tsx': `export function Row() { return <li>Row</li>; }`,
    }, {
      packageEntries: { 'bad-row-package': './index.tsx' },
    }).artifact);
    const row = artifact.entries['bad-row-package']!.components!.Row!;
    (row as { listLightweight: boolean }).listLightweight = true;

    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { Row } from 'bad-row-package';
        export function App() { return <ul><Row /></ul>; }
      `,
    }, {
      experimentalPackageArtifacts: [artifact],
    })).toThrow("advertises an unsupported lightweight row ABI");
  });

  it('compiles the real request-state utilities without utility-name handling', async () => {
    const utilitySource = readFileSync(
      join(import.meta.dirname, '..', 'packages', 'utils', 'src', 'request-state.ts'),
      'utf8',
    );
    const packaged = experimentalCompilePackage({
      './request-state.ts': utilitySource,
    }, {
      packageEntries: { 'track-utils': './request-state.ts' },
      runtimePath: '@memoized-dom/runtime/testing',
    });
    expect(
      packaged.artifact.entries['track-utils']!.functions.pending,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: [] }],
      parameterPayloadReads: [],
    });
    expect(
      packaged.artifact.entries['track-utils']!.functions.status,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: [] }],
      parameterPayloadReads: [],
    });

    const application = compileModulesDetailed({
      './utils-app.tsx': `
        import { pending, status } from 'track-utils';
        export function UtilsApp() {
          const stories = $fetch('/api/utils-stories');
          const waiting = pending(stories);
          return <p>{waiting
            ? 'Loading'
            : status(stories) + ':' + stories.length}</p>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'track-utils');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(
      join(packageDir, 'index.js'),
      packaged.output['./request-state.ts']!,
    );
    writeFileSync(
      join(outDir, 'utils-app.js'),
      application.output['./utils-app.tsx']!,
    );

    const request = Promise.withResolvers<Response>();
    const data = createDataRuntime({ fetch: () => request.promise });
    const previous = setActiveDataRuntime(data);
    document.body.replaceChildren();
    try {
      const { UtilsApp } = await import(
        `${pathToFileURL(join(outDir, 'utils-app.js')).href}?runtime=${Date.now()}`
      );
      const paragraph = UtilsApp('PackageTrackUtilsApp', null) as HTMLParagraphElement;
      document.body.append(paragraph);
      expect(paragraph.textContent).toBe('Loading');

      request.resolve(Response.json([{ id: 1 }]));
      await waitFor(() => {
        expect(paragraph.textContent).toBe('success:1');
      });
      expect(document.querySelector('p')).toBe(paragraph);
    } finally {
      unregister('PackageTrackUtilsApp');
      data.clear();
      setActiveDataRuntime(previous);
      document.body.replaceChildren();
    }
  });

  it('links optimistic source holders through package metadata without compiler name handling', () => {
    expect(
      utilsPackageArtifact.entries['@memoized-dom/utils']!.functions.optimistic,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: ['source'] }],
    });

    const application = compileModulesDetailed({
      './app.tsx': `
        import { optimistic as mutate } from '@memoized-dom/utils';
        export function App() {
          const first = $fetch('/first');
          const second = $fetch('/second');
          const save = mutate({
            source: [first, second],
            action: () => Promise.resolve(1),
            apply: () => () => {},
          });
          return <button onClick={() => save()}>Save</button>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [utilsPackageArtifact],
    });

    const output = application.output['./app.tsx']!;
    expect(output).toContain('source: [first, second]');
    expect(output).not.toMatch(
      /source: \[(?:_MDD\.)?(?:readResolvedValue|readModuleSource)/,
    );
  });

  it('composes request-state relationships through package re-exports', () => {
    const packaged = experimentalCompilePackage({
      './pending.ts': `
        import { $track } from '@memoized-dom/data';
        export function pending(source) {
          return $track(source).pending;
        }
      `,
      './index.ts': `
        import { pending } from './pending';
        export function waitingFor(source) {
          return pending(source);
        }
      `,
    }, {
      packageEntries: { 'status-package': './index.ts' },
    });

    expect(
      packaged.artifact.entries['status-package']!.functions.waitingFor,
    ).toMatchObject({
      parameterSourceReads: [{ index: 0, path: [] }],
      parameterPayloadReads: [],
    });

    const application = compileModulesDetailed({
      './app.tsx': `
        import { waitingFor as pending } from 'status-package';
        export function App() {
          const stories = $fetch('/stories');
          return <p>{pending(stories) ? 'Loading' : 'Ready'}</p>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
    });

    expect(application.output['./app.tsx']).toContain('pending(stories)');
    expect(application.output['./app.tsx']).not.toMatch(
      /deriveResolvedValues\(\[stories\].*pending/s,
    );
  });

  it('preserves an event-created request holder through a packaged projection', () => {
    const functions = generateServerFunctionClient(analyzeServerFunctionModule(`
      export const postVote = define.function({
        post: async (_context, id: number) => ({ id }),
      });
    `, { moduleId: '/app/server/functions/votes.ts' }));
    const application = compileModulesDetailed({
      './app.tsx': `
        import { pending } from '@memoized-dom/utils';
        import { postVote } from './functions';
        export function App() {
          let lastVote: ReturnType<typeof postVote> | null = null;
          return <main>
            <button onClick={() => { lastVote = postVote(1); }}>Vote</button>
            {lastVote !== null && <p>{pending(lastVote) ? 'Voting' : 'Saved'}</p>}
          </main>;
        }
      `,
      './functions.ts': functions,
    }, {
      experimentalPackageArtifacts: [utilsPackageArtifact],
    });

    const output = application.output['./app.tsx']!;
    expect(output).toContain('createEventSourceSlot()');
    expect(output).toContain('pending(lastVote)');
    expect(output).not.toMatch(
      /deriveResolvedValues\(\[lastVote\].*pending/s,
    );
  });

  it('links precompiled prop, local-state, and slot components', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        export function Badge({ value }: { value: number }) {
          let local = 0;
          return <button data-badge onClick={() => local++}>{value}:{local}</button>;
        }

        export function Panel() {
          return <section data-panel><slot><i>Fallback</i></slot></section>;
        }

        export function ForwardInput({ ref }: { ref: (node: HTMLInputElement) => void }) {
          return <input data-forwarded ref={ref} />;
        }
      `,
    }, {
      packageEntries: { 'ui-package': './index.tsx' },
      runtimePath: '@memoized-dom/runtime/testing',
    });

    expect(packaged.artifact.entries['ui-package']!.components).toMatchObject({
      Badge: {
        props: ['value'],
        renderProps: [],
        slots: [],
      },
      Panel: {
        slots: [''],
      },
      ForwardInput: {
        refProps: ['ref'],
      },
    });

    const application = compileModulesDetailed({
      './component-app.tsx': `
        import { Badge, ForwardInput, Panel } from 'ui-package';
        export function ComponentApp() {
          let value = 1;
          return <main>
            <Badge value={value} />
            <button data-parent onClick={() => value++}>Parent</button>
            <Panel><strong>Projected</strong></Panel>
            <ForwardInput ref={node => { globalThis.__packagedRef = node; }} />
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'ui-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'component-app.js'),
      application.output['./component-app.tsx']!,
    );

    document.body.replaceChildren();
    try {
      const { ComponentApp } = await import(
        `${pathToFileURL(join(outDir, 'component-app.js')).href}?runtime=${Date.now()}`
      );
      const main = ComponentApp('PackageComponentApp', null) as HTMLElement;
      document.body.append(main);
      const badge = main.querySelector<HTMLButtonElement>('[data-badge]')!;
      const parent = main.querySelector<HTMLButtonElement>('[data-parent]')!;
      expect(badge.textContent).toBe('1:0');
      expect(main.querySelector('[data-panel]')?.textContent).toBe('Projected');
      await waitFor(() => {
        expect((globalThis as Record<string, unknown>).__packagedRef).toBe(
          main.querySelector('[data-forwarded]'),
        );
      }, 5_000);

      badge.click();
      await waitFor(() => {
        expect(badge.textContent).toBe('1:1');
      });
      parent.click();
      await waitFor(() => {
        expect(badge.textContent).toBe('2:1');
      });
      expect(main.querySelector<HTMLButtonElement>('[data-badge]')).toBe(badge);
    } finally {
      unregister('PackageComponentApp');
      delete (globalThis as Record<string, unknown>).__packagedRef;
      document.body.replaceChildren();
    }
  });

  it('keeps packaged scalar and render-prop modes exact', () => {
    const renderPackage = experimentalCompilePackage({
      './index.tsx': `
        export function RenderValue({ value }) {
          return <b>{value}</b>;
        }
      `,
    }, {
      packageEntries: { 'render-package': './index.tsx' },
    });
    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { RenderValue } from 'render-package';
        export function App() { return <RenderValue value={1} />; }
      `,
    }, {
      experimentalPackageArtifacts: [renderPackage.artifact],
    })).toThrow("render prop 'value' on <RenderValue> must be JSX");

    const scalarPackage = experimentalCompilePackage({
      './index.tsx': `
        export function ScalarValue({ value }: { value: number }) {
          return <b>{value}</b>;
        }
      `,
    }, {
      packageEntries: { 'scalar-package': './index.tsx' },
    });
    expect(() => compileModulesDetailed({
      './app.tsx': `
        import { ScalarValue } from 'scalar-package';
        export function App() {
          return <ScalarValue value={<i>Wrong mode</i>} />;
        }
      `,
    }, {
      experimentalPackageArtifacts: [scalarPackage.artifact],
    })).toThrow("JSX prop 'value' on <ScalarValue> is not rendered by the callee");
  });

  it('renders a precompiled package component during SSR', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        export function ServerCard({ value }: { value: number }) {
          return <article data-server-card>Server value: {value}</article>;
        }
      `,
    }, {
      packageEntries: { 'ui-server-package': './index.tsx' },
    });
    const application = compileModulesDetailed({
      './server-component-app.tsx': `
        import { ServerCard } from 'ui-server-package';
        export function ServerComponentApp() {
          return <main><ServerCard value={7} /></main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      routedEnvironment: 'server',
      moduleStateCells: true,
    });

    const packageDir = join(outDir, 'node_modules', 'ui-server-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'server-component-app.js'),
      application.output['./server-component-app.tsx']!,
    );
    const { ServerComponentApp } = await import(
      `${pathToFileURL(join(outDir, 'server-component-app.js')).href}?runtime=${Date.now()}`
    );
    registerRootFactory(ServerComponentApp, {
      id: 'PackageServerComponentApp',
      create: () => ServerComponentApp('PackageServerComponentApp', null),
    });
    try {
      expect(renderToString(ServerComponentApp)).toContain(
        '<article data-server-card="true">Server value: 7</article>',
      );
    } finally {
      unregister('PackageServerComponentApp');
    }
  });

  it('uses the ordinary component ABI when an app maps a packaged row', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        interface Item { id: number; label: string }
        export function ItemRow({ item }: { item: Item }) {
          return <li data-row={item.id}>{item.label}</li>;
        }
      `,
    }, {
      packageEntries: { 'ui-row-package': './index.tsx' },
      runtimePath: '@memoized-dom/runtime/testing',
    });
    expect(
      packaged.artifact.entries['ui-row-package']!.components!.ItemRow,
    ).toMatchObject({ listLightweight: false });

    const application = compileModulesDetailed({
      './row-component-app.tsx': `
        import { ItemRow } from 'ui-row-package';
        export function RowComponentApp() {
          let items = [{ id: 1, label: 'One' }];
          return <main>
            <ul>{items.map(item => <ItemRow key={item.id} item={item} />)}</ul>
            <button data-add onClick={() => items.push({ id: 2, label: 'Two' })}>Add</button>
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'ui-row-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'row-component-app.js'),
      application.output['./row-component-app.tsx']!,
    );

    document.body.replaceChildren();
    try {
      const { RowComponentApp } = await import(
        `${pathToFileURL(join(outDir, 'row-component-app.js')).href}?runtime=${Date.now()}`
      );
      const main = RowComponentApp('PackageRowComponentApp', null) as HTMLElement;
      document.body.append(main);
      const first = main.querySelector<HTMLLIElement>('[data-row="1"]')!;
      expect(first.textContent).toBe('One');

      main.querySelector<HTMLButtonElement>('[data-add]')!.click();
      await waitFor(() => {
        expect(main.querySelectorAll('li')).toHaveLength(2);
      });
      expect(main.querySelector<HTMLLIElement>('[data-row="1"]')).toBe(first);
      expect(main.querySelector<HTMLLIElement>('[data-row="2"]')?.textContent).toBe('Two');
    } finally {
      unregister('PackageRowComponentApp');
      document.body.replaceChildren();
    }
  });

  it('updates a keyed list through nested precompiled package components', async () => {
    const packaged = experimentalCompilePackage({
      './index.tsx': `
        interface Item { id: number; label: string }
        export function ItemRow({ item }: { item: Item }) {
          return <li data-row={item.id}>{item.label}</li>;
        }
        export function ItemList({ items }: { items: Item[] }) {
          return <ul>{items.map(item => <ItemRow key={item.id} item={item} />)}</ul>;
        }
      `,
    }, {
      packageEntries: { 'ui-list-package': './index.tsx' },
      runtimePath: '@memoized-dom/runtime/testing',
    });
    const application = compileModulesDetailed({
      './list-component-app.tsx': `
        import { ItemList } from 'ui-list-package';
        export function ListComponentApp() {
          let items = [{ id: 1, label: 'One' }];
          return <main>
            <ItemList items={items} />
            <button data-add onClick={() => items.push({ id: 2, label: 'Two' })}>Add</button>
          </main>;
        }
      `,
    }, {
      experimentalPackageArtifacts: [packaged.artifact],
      runtimePath: '@memoized-dom/runtime/testing',
    });

    const packageDir = join(outDir, 'node_modules', 'ui-list-package');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ type: 'module', exports: './index.js' }),
    );
    writeFileSync(join(packageDir, 'index.js'), packaged.output['./index.tsx']!);
    writeFileSync(
      join(outDir, 'list-component-app.js'),
      application.output['./list-component-app.tsx']!,
    );

    document.body.replaceChildren();
    try {
      const { ListComponentApp } = await import(
        `${pathToFileURL(join(outDir, 'list-component-app.js')).href}?runtime=${Date.now()}`
      );
      const main = ListComponentApp('PackageListComponentApp', null) as HTMLElement;
      document.body.append(main);
      const first = main.querySelector<HTMLLIElement>('[data-row="1"]')!;
      expect(first.textContent).toBe('One');

      main.querySelector<HTMLButtonElement>('[data-add]')!.click();
      await waitFor(() => {
        expect(main.querySelectorAll('li')).toHaveLength(2);
      });
      expect(main.querySelector<HTMLLIElement>('[data-row="1"]')).toBe(first);
      expect(main.querySelector<HTMLLIElement>('[data-row="2"]')?.textContent).toBe('Two');
    } finally {
      unregister('PackageListComponentApp');
      document.body.replaceChildren();
    }
  });
});
