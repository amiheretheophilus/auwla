import { expect, it, vi } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileModulesDetailed, emitInitialHtml, experimentalCompilePackage, validateExperimentalPackageArtifact } from '@memoized-dom/compiler';
import { mountInitial, registerEntity, unregisterSubtree, createApplicationRuntime, runWithApplicationRuntime, commit } from '@memoized-dom/runtime/testing';
import { waitFor } from '../test-support/helpers';

it.each([true, false])('adopts package-owned events and slots without replacing initial DOM (open=%s)', async open => {
  const runtimePath = '@memoized-dom/runtime/testing';
  const packaged = experimentalCompilePackage({
    './index.tsx': `
      export function Action({ label, amount, onPress }: { label: string; amount: number; onPress: (amount: number) => void }) {
        return <button class="action" data-amount={amount} onClick={() => onPress(amount)}>{label}</button>;
      }
      export function Editor({ value, onEdit }: { value: string; onEdit: (value: string) => void }) {
        return <input class="editor" value={value} onInput={event => onEdit(event.currentTarget.value)} />;
      }
      export function Panel({ onPress }: { onPress: () => void }) {
        return <section><button class="package-button" onClick={onPress}>Package</button><main><slot /></main></section>;
      }
    `,
  }, { runtimePath, packageEntries: { 'event-ui': './index.tsx' } });
  for (const component of Object.values(packaged.artifact.entries['event-ui']!.components!)) {
    expect(component.initial?.adoption).toBe('host-events-v1');
  }
  const application = compileModulesDetailed({
    './main.ts': `import { mount } from '${runtimePath}'; import { App } from './app'; mount('root', App);`,
    './app.tsx': `import { Action, Editor, Panel } from 'event-ui';
      export function App() {
        let count = 0; let text = 'Before'; let amount = 1; let open = ${open};
        return <div><Action label="Add" amount={amount} onPress={value => count += value} />
          <Action label="Toggle" amount={0} onPress={() => open = !open} />
          <Action label="Amount" amount={0} onPress={() => amount++} />
          <Editor value={text} onEdit={value => text = value} />
          {open && <Panel onPress={() => count++}><b>{count}</b><input class="draft" /></Panel>}
          <Panel onPress={() => count++} /><output>{count}:{text}</output></div>;
      }`,
  }, { runtimePath, initialContent: true, experimentalPackageArtifacts: [JSON.parse(JSON.stringify(packaged.artifact))] });
  expect(application.initialContent).toBe(true);
  expect(application.initialRender.kind).toBe('bindings');
  expect(application.initialDelivery?.browser).toBe('bindings');
  const html = emitInitialHtml(application.initialRender)!;
  expect(html).toContain('<button class="action" data-amount="1">Add</button>');
  expect(html).not.toContain('onClick');
  const directory = join(import.meta.dirname, 'fixtures/out/package-events', String(open));
  const packageDirectory = join(directory, 'node_modules/event-ui');
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  writeFileSync(join(packageDirectory, 'index.js'), packaged.output['./index.tsx']!);
  writeFileSync(join(directory, 'app.js'), application.output['./app.tsx']!);
  document.body.innerHTML = `<div id="root">${html}</div>`;
  const original = [...document.querySelectorAll('*')];
  const create = vi.spyOn(document, 'createElement');
  let mounted: ReturnType<typeof mountInitial> | undefined;
  const action = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.action')].find(node => node.textContent === label)!;
  try {
    const { App } = await import(`${pathToFileURL(join(directory, 'app.js')).href}?events=${Date.now()}`);
    mounted = mountInitial('root', App);
    expect(create).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('*')].every((node, index) => node === original[index])).toBe(true);
    create.mockRestore();
    if (!open) {
      action('Toggle').click();
    await waitFor(() => expect(document.querySelector('.draft') !== null).toBe(true));
    }
    const draft = document.querySelector<HTMLInputElement>('.draft')!;
    const section = draft.closest('section');
    draft.value = 'Keep this';
    action('Add').click();
    await waitFor(() => expect(document.querySelector('output')!.textContent).toBe('1:Before'));
    action('Amount').click();
    await waitFor(() => expect(action('Add').getAttribute('data-amount')).toBe('2'));
    action('Add').click();
    await waitFor(() => expect(document.querySelector('output')!.textContent).toBe('3:Before'));
    const editor = document.querySelector<HTMLInputElement>('.editor')!;
    editor.value = 'After';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => expect(document.querySelector('output')!.textContent).toBe('3:After'));
    section!.querySelector<HTMLButtonElement>('.package-button')!.click();
    await waitFor(() => expect(document.querySelector('b')!.textContent).toBe('4'));
    expect(document.querySelector('.draft')).toBe(draft);
    expect(draft.value).toBe('Keep this');
    const oldButton = section!.querySelector<HTMLButtonElement>('.package-button')!;
    action('Toggle').click();
    await waitFor(() => expect(document.querySelector('.draft') === null).toBe(true));
    expect(oldButton.isConnected).toBe(false);
    expect(document.querySelector('output')!.textContent).toBe('4:After');
    action('Toggle').click();
    await waitFor(() => expect(document.querySelector('b')!.textContent).toBe('4'));
    expect(document.querySelector('.draft')).not.toBe(draft);
    document.querySelector<HTMLButtonElement>('.package-button')!.click();
    await waitFor(() => expect(document.querySelector('b')!.textContent).toBe('5'));
  } finally {
    create.mockRestore(); mounted?.unmount(); document.body.replaceChildren();
  }
});

it('does not drop package-owned events when every initial prop is constant', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const packaged = experimentalCompilePackage({
      './index.tsx': `export function Button() { return <button onClick={() => console.log('clicked')}>Press</button>; }`,
    }, { packageEntries: { 'constant-ui': './index.tsx' } });
    const application = compileModulesDetailed({
      './main.ts': `import { mount } from '@memoized-dom/runtime'; import { App } from './app'; mount('root', App);`,
      './app.tsx': `import { Button } from 'constant-ui'; export function App() { return <main><Button /></main>; }`,
    }, { initialContent: true, experimentalPackageArtifacts: [packaged.artifact] });
    expect(application.initialRender.kind).toBe('bindings');
    expect(application.output['./app.tsx']).toContain('Button(');
    expect(JSON.stringify(packaged.artifact)).not.toContain('console.log');
    expect(log).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it('keeps unsupported interactive package shapes on ordinary creation and validates slot bounds', () => {
  const packaged = experimentalCompilePackage({
    './index.tsx': `export function Mixed() { return <section onClick={() => {}}>Before<slot />After</section>; }
      export function Fallback() { return <section><main onClick={() => {}}><slot><b>Empty</b></slot></main></section>; }
      export function Setup() { let clicks = 0; return <button onClick={() => clicks++}>{clicks}</button>; }`,
  }, { packageEntries: { 'unsupported-ui': './index.tsx' } });
  const components = packaged.artifact.entries['unsupported-ui']!.components!;
  expect(components.Mixed.initial).toBeUndefined();
  expect(components.Setup.initial).toBeUndefined();
  expect(components.Fallback.initial?.adoption).toBe('host-slots-v2');
  expect(components.Fallback.initial?.events).toBe(true);
  const invalid = structuredClone(experimentalCompilePackage({
    './index.tsx': `export function Panel() { return <section><b>Before</b><slot /></section>; }`,
  }, { packageEntries: { 'bad-ui': './index.tsx' } }).artifact);
  invalid.entries['bad-ui']!.components!.Panel.initial!.adoption = 'host-events-v1';
  expect(() => validateExperimentalPackageArtifact(invalid)).toThrow('host-events-v1 requires dedicated slot hosts without fallbacks');
});

it.each([true, false])('keeps opaque package handler invalidation relative to its mounted root (adopt=%s)', async adopt => {
  const packaged = experimentalCompilePackage({
    './index.tsx': `export function Action({amount,onPress}:{amount:number;onPress:(amount:number)=>void}) {
      return <button onClick={()=>onPress(amount)}>{amount}</button>;
    }`,
  }, { runtimePath: '@memoized-dom/runtime/testing', packageEntries: { 'rootless-ui': './index.tsx' } });
  const directory = join(import.meta.dirname, 'fixtures/out/package-events-root', String(adopt));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'index.js'), packaged.output['./index.tsx']!);
  const { Action } = await import(`${pathToFileURL(join(directory, 'index.js')).href}?root=${Date.now()}`);
  let value = 0;
  const seen: number[] = [];
  let unrelated = 0;
  // An opaque callback has no application-compiler instrumentation. Its package
  // event uses conservative invalidation, but cannot bake in the root name App.
  registerEntity({ id: 'Dashboard', parent: null, render: () => seen.push(value) });
  registerEntity({ id: 'App', parent: null, render: () => unrelated++ });
  document.body.innerHTML = adopt ? '<button>1</button>' : '';
  const host = document.querySelector('button');
  try {
    const button = Action('Dashboard/Action', 'Dashboard', [{ amount: 1, onPress: (amount: number) => value += amount }], undefined, host ?? undefined);
    if (!adopt) document.body.appendChild(button);
    button.click();
    await waitFor(() => expect(seen).toEqual([1]));
    expect(unrelated).toBe(0);
  } finally {
    unregisterSubtree('Dashboard'); unregisterSubtree('App'); document.body.replaceChildren();
  }
});

it('keeps a shared opaque package handler inside the active application runtime', async () => {
  const packaged = experimentalCompilePackage({
    './index.tsx': `import { mutate } from 'opaque-runtime';
      function shared(event) { mutate(event); }
      export function Button({label}:{label:string}) { return <button onClick={shared}>{label}</button>; }`,
  }, { runtimePath: '@memoized-dom/runtime/testing', packageEntries: { 'shared-ui': './index.tsx' } });
  expect(packaged.output['./index.tsx']).toContain('_MD.markOwnerRootDirty()');
  expect(packaged.output['./index.tsx']).not.toContain('"App"');
  const directory = join(import.meta.dirname, 'fixtures/out/package-shared-events');
  const dependency = join(directory, 'node_modules/opaque-runtime');
  mkdirSync(dependency, { recursive: true });
  writeFileSync(join(dependency, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }));
  writeFileSync(join(dependency, 'index.js'), `export function mutate(event) { event.currentTarget.dataset.changed = 'yes'; }`);
  writeFileSync(join(directory, 'index.js'), packaged.output['./index.tsx']!);
  const { Button } = await import(`${pathToFileURL(join(directory, 'index.js')).href}?shared=${Date.now()}`);
  const application = createApplicationRuntime('package-shared-one', { document, schedule: null });
  const other = createApplicationRuntime('package-shared-other', { document, schedule: null });
  const seen: string[] = [];
  let unrelated = 0;
  try {
    runWithApplicationRuntime(other, () => registerEntity({ id: 'App', parent: null, render: () => unrelated++ }));
    runWithApplicationRuntime(application, () => {
      registerEntity({ id: 'Dashboard', parent: null, render: () => seen.push(document.querySelector('button')!.dataset.changed!) });
      const button = Button('Dashboard/Button', 'Dashboard', [{ label: 'Press' }]);
      document.body.appendChild(button);
      button.click();
      commit();
    });
    expect(seen).toEqual(['yes']);
    expect(unrelated).toBe(0);
  } finally { application.dispose(); other.dispose(); document.body.replaceChildren(); }
});
