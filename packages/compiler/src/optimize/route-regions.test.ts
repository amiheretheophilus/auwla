/**
 * A component's route region is one value slot (`route-regions.ts`). How it behaves across
 * navigation is compared with the reference in both modes by `tests/cases/routes.test.ts`.
 */
import { expect, it } from 'bun:test';
import { compileModules } from '../pipeline';

const SOURCE = `
  function About() { return <p id="about">About us</p>; }
  export function App() {
    return <main>
      <About route="/about" />
      <section route="/"><h1>Home</h1></section>
    </main>;
  }`;

function compile(optimize: boolean | { readonly skip: readonly string[] }): string {
  return compileModules({ './App.tsx': SOURCE }, { optimize })['./App.tsx']!;
}

function conditionals(output: string): number {
  return output.split('createCondRegion(').length - 1;
}

it("shows a component's route region as one value slot, and leaves an element's", () => {
  const general = compile(false);
  const optimized = compile(true);

  expect(conditionals(general)).toBe(2);
  // The <section>'s region keeps its conditional: its branch clones a template.
  expect(conditionals(optimized)).toBe(1);
  expect(optimized).toMatch(/\$routeRegion\("[^"]*About[^"]*"\) && /);
});

it('can be left out alone, which the navigation benchmark times it against', () => {
  expect(conditionals(compile({ skip: ['route-regions'] }))).toBe(2);
  expect(() => compile({ skip: ['route-region'] })).toThrow('optimize.skip names no pass: route-region');
});
