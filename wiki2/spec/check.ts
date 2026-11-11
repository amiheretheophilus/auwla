/**
 * Independent baseline evidence: fixture integrity and current-JSX equivalents.
 * Extended-source checks run separately in packages/jsx-plus. Never claim that
 * this baseline checker parses extended source. Owned by spec/conformance.md.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { compile } from '../../packages/compiler-next/src/index';
import { toModuleFunction } from '../../packages/compiler-next/src/core/parse/module-function';
import * as runtime from '../../packages/runtime/src/index';

// Use compiler-next's parser version, rather than the different root dependency.
const root = resolve(import.meta.dirname, '../..');
const requireCompiler = createRequire(resolve(root, 'packages/compiler-next/package.json'));
const { parse } = await import(pathToFileURL(requireCompiler.resolve('yuku-parser')).href);
const catalog = JSON.parse(readFileSync(resolve(import.meta.dirname, 'cases.json'), 'utf8'));
const schema = JSON.parse(readFileSync(resolve(import.meta.dirname, 'ast.schema.json'), 'utf8'));
assert.equal(catalog.specVersion, '0.1-draft');
assert.equal(catalog.revision, 5);
assert.equal(schema.properties.specVersion.const, catalog.specVersion);

const documents = readdirSync(import.meta.dirname)
  .filter((name) => name.endsWith('.md'))
  .map((name) => readFileSync(resolve(import.meta.dirname, name), 'utf8'))
  .join('\n');
const ruleIds = new Set(documents.match(/\b(?:G|A|S|D|C)-[A-Z]+\b/g));
const codes = new Set(documents.match(/\bJPX\d{4}\b/g));
const ids = new Set<string>();
const counts = { parseFixtures: 0, diagnosticFixtures: 0, hostChecks: 0, jsxChecks: 0 };

function range(source: string, span: number[], parent = [0, source.length]): void {
  assert.equal(span.length, 2);
  assert(span.every(Number.isInteger));
  assert(parent[0]! <= span[0]! && span[0]! <= span[1]! && span[1]! <= parent[1]!);
}

function view(source: string, node: any, parent?: number[]): void {
  range(source, node.range, parent);
  assert(['element', 'fragment', 'expression', 'if', 'for', 'block'].includes(node.kind));

  if (node.kind === 'expression') {
    assert.equal(source.slice(node.range[0], node.range[1]), node.source);
    assert(node.source.length > 0);
    return;
  }

  if (node.kind === 'element') {
    assert(node.name.length > 0);
    assert(source.slice(node.range[0]).startsWith(`<${node.name}`));
  }

  if (node.kind === 'if') {
    assert.equal(node.test.kind, 'expression');
    assert.equal(node.consequent.kind, 'block');
    view(source, node.test, node.range);
    view(source, node.consequent, node.range);
    if (node.alternate !== null) {
      assert(['block', 'if'].includes(node.alternate.kind));
      view(source, node.alternate, node.range);
    }
    return;
  }

  if (node.kind === 'for') {
    assert.equal(node.binding.kind, 'expression');
    assert.equal(node.iterable.kind, 'expression');
    assert.equal(node.body.kind, 'block');
    assert(source.slice(node.range[0]).startsWith('for'));
    view(source, node.binding, node.range);
    view(source, node.iterable, node.range);
    view(source, node.body, node.range);
    return;
  }

  assert(Array.isArray(node.children));
  let previous = node.range[0];
  for (const child of node.children) {
    assert(previous <= child.range[0]);
    view(source, child, node.range);
    previous = child.range[1];
  }
}

function host(source: string): any {
  const result = parse(source, { lang: 'tsx', sourceType: 'module' });
  assert.deepEqual(result.diagnostics.filter((entry: any) => entry.severity === 'error'), []);
  return result.program;
}

async function baseline(fixture: any, optimize: boolean): Promise<void> {
  host(fixture.jsxEquivalent);
  const code = compile(fixture.jsxEquivalent, { optimize });
  const module = toModuleFunction(code);
  const exports: Record<string, any> = {};
  const imports = module.specifiers.map((specifier) => {
    assert.equal(specifier, '@memoized-dom/runtime');
    return runtime;
  });

  new Function('_imports', '_exports', '_exportStar', ...module.globals, module.body)(
    imports, exports, () => {},
    ...module.globals.map((name) => (globalThis as Record<string, unknown>)[name]),
  );

  const container = document.createElement('div');
  container.id = `spec-${fixture.id}-${optimize}`;
  document.body.append(container);
  const mounted = runtime.mount(container.id, exports.App);
  const expected = fixture.expected;

  const keep = expected.preserveNodes;
  const oldNodes = keep === undefined ? null : new Map(
    [...container.querySelectorAll(keep.selector)].map((node) => [node.getAttribute(keep.keyAttribute), node]),
  );

  assert.equal(container.textContent, expected.text[0]);
  if (expected.ref !== undefined) {
    assert.equal(exports[expected.ref.export], container.querySelector(expected.ref.selector));
  }

  for (const [index, selector] of (expected.clicks ?? []).entries()) {
    const button = container.querySelector(selector) as HTMLElement | null;
    assert(button !== null, `Missing click target ${selector}`);
    button.click();
    assert.equal(container.textContent, expected.text[index + 1]);

    if (oldNodes !== null) {
      for (const node of container.querySelectorAll(keep.selector)) {
        assert.equal(node, oldNodes.get(node.getAttribute(keep.keyAttribute)));
      }
    }
  }

  mounted.unmount();
  if (expected.ref !== undefined) assert.equal(exports[expected.ref.export], undefined);
  container.remove();
  await Promise.resolve();
}

GlobalRegistrator.register();
runtime.setScheduler((run) => run());

for (const fixture of catalog.cases) {
  assert.match(fixture.id, /^[A-Z]+-\d{3}$/);
  assert(!ids.has(fixture.id), `Duplicate fixture ${fixture.id}`);
  ids.add(fixture.id);
  assert.equal(typeof fixture.source, 'string');
  assert(fixture.source.length > 0);
  assert(fixture.rules.length > 0);
  for (const rule of fixture.rules) assert(ruleIds.has(rule), `Missing rule ${rule}`);

  process.stdout.write(`${fixture.id}: `);
  if (fixture.level === 'parse') {
    assert.equal(fixture.expected.specVersion, catalog.specVersion);
    assert.deepEqual(fixture.expected.root.range, [0, fixture.source.length]);
    view(fixture.source, fixture.expected.root);
    counts.parseFixtures++;
    console.log('expected view/ranges checked; extended parse NOT RUN');
  } else if (fixture.level === 'diagnostics') {
    assert(codes.has(fixture.expected.code));
    assert.equal(fixture.expected.severity, 'error');
    range(fixture.source, fixture.expected.range);
    counts.diagnosticFixtures++;
    console.log('expected diagnostic checked; extended diagnostics NOT RUN');
  } else if (fixture.level === 'host') {
    const program = host(fixture.source);
    assert.deepEqual(program.body.map((node: any) => node.expression?.type), fixture.expected.expressionKinds);
    counts.hostChecks++;
    console.log('existing host parser passed');
  } else if (fixture.level === 'behavior') {
    assert.equal(fixture.expected.text.length, (fixture.expected.clicks?.length ?? 0) + 1);
    await baseline(fixture, true);
    await baseline(fixture, false);
    counts.jsxChecks += 2;
    console.log('existing JSX baseline passed in both modes; extended execution NOT RUN');
  } else {
    assert.fail(`Unknown fixture level ${fixture.level}`);
  }
}

runtime.resetScheduler();
await GlobalRegistrator.unregister();
console.log(JSON.stringify({ fixtures: ids.size, ...counts, extendedSyntaxConformance: 'NOT RUN' }));
