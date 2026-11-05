/** Which `$fetch` imports may become the smaller function, in each kind of build. */
import { expect, it } from 'bun:test';
import { compileModules } from '../../pipeline';

/** The import a module with `body` gets for `$fetch`. */
function compiled(body: string, dataDelivery?: 'universal' | 'client', imports = "import { $fetch } from '@memoized-dom/data';"): string {
  return compileModules({
    './App.tsx': `${imports}\n${body}\nexport function App() { return <p>hello</p>; }`,
  }, dataDelivery === undefined ? {} : { dataDelivery })['./App.tsx']!;
}

const PUBLIC = /import \{[^}]*\$fetch[^}]*\} from ["']@memoized-dom\/data["']/;
const CLIENT = /import \{ createClientSource as \$fetch \} from ["']@memoized-dom\/data\/internal["']/;
const BODYLESS = /import \{ createBodylessSource as \$fetch \} from ["']@memoized-dom\/data\/internal["']/;

it('a call that loads with no body gets the smaller function, by kind of build', () => {
  const load = "export const load = () => $fetch('/user');";
  expect(compiled(load, 'client')).toMatch(CLIENT);
  expect(compiled(load, 'universal')).toMatch(BODYLESS);
  expect(compiled(load)).toMatch(BODYLESS);
});

it.each([
  ['query options', "$fetch('/user', { query: { id: 1 } })"],
  ['an explicit GET', "$fetch('/user', { method: 'GET', headers: {} })"],
  ['a lower-case get', "$fetch('/user', { method: 'get' })"],
  ['a computed target', "$fetch('/user/' + Math.random())"],
  ['a null target', '$fetch(null)'],
])('accepts %s', (_name, call) => {
  expect(compiled(`export const load = () => ${call};`, 'client')).toMatch(CLIENT);
});

// Each of these needs what only the public `$fetch` has.
it.each([
  ['a body', "$fetch('/user', { body: 'x' })"],
  ['a body in quotes', "$fetch('/user', { 'body': 'x' })"],
  ['an action, whose result is a promise', "$fetch('/user', { method: 'POST' })"],
  ['HEAD, whose result is a promise', "$fetch('/user', { method: 'HEAD' })"],
  ['a method chosen at runtime', "$fetch('/user', { method: window.m })"],
  ['options it cannot read', "$fetch('/user', window.options)"],
  ['spread options', "$fetch('/user', { ...window.options })"],
  ['a computed option', "$fetch('/user', { [window.key]: 1 })"],
  ['spread arguments', '$fetch(...window.args)'],
  ['extra arguments', "$fetch('/user', {}, 1)"],
])('keeps the public function for %s', (_name, call) => {
  const output = compiled(`export const load = () => ${call};`, 'client');
  expect(output).toMatch(PUBLIC);
  expect(output).not.toContain('createClientSource');
});

it.each([
  ['passing it along', 'export const load = () => window.run($fetch);'],
  ['a copy of it', 'const get = $fetch; export const load = () => get("/user");'],
  ['exporting it', 'export { $fetch };'],
])('keeps the public function for %s', (_name, body) => {
  expect(compiled(body, 'client')).toMatch(PUBLIC);
});

it('one call that needs the public function keeps it for the whole module', () => {
  const output = compiled("export const a = () => $fetch('/a'); export const b = () => $fetch('/b', { body: 'x' });", 'client');
  expect(output).toMatch(PUBLIC);
});

it('keeps the other names of the import, and an aliased name', () => {
  const load = "export const load = () => $fetch('/user'); export const read = (x) => $track(x);";
  const output = compiled(load, 'client', "import { $fetch, $track } from '@memoized-dom/data';");
  expect(output).toMatch(CLIENT);
  expect(output).toMatch(/import \{ \$track \} from ["']@memoized-dom\/data["']/);

  const aliased = compiled("export const load = () => get('/user');", 'client', "import { $fetch as get } from '@memoized-dom/data';");
  expect(aliased).toMatch(/createClientSource as get/);
});

it('an unused import is left as written', () => {
  expect(compiled('', 'client')).not.toContain('createClientSource');
});

it('leaves a name that only looks like it alone', () => {
  const output = compiled("export const load = () => $fetch('/user');", 'client', "import { $fetch } from './mine';");
  expect(output).toContain('./mine');
  expect(output).not.toContain('createClientSource');
});
