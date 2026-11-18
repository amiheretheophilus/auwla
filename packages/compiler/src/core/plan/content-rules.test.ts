/** An element gets its content from innerHTML or from JSX children, not both (`content-rules.ts`). */
import { describe, expect, it } from 'bun:test';
import { compileModules } from '../..';

function compile(source: string): void {
  compileModules({ './App.tsx': source });
}

describe('innerHTML and JSX children', () => {
  it('refuses both on one element, at the first child', () => {
    expect(() => compile(`
      export function App() { return <div innerHTML="<b>x</b>"><i>y</i></div>; }
    `)).toThrow(/<div> sets innerHTML and also has JSX children, and only one can be its content\. Use one or the other\. \(\.\/App\.tsx:2:64\)/);
  });

  it('refuses a dynamic innerHTML with text or an expression child', () => {
    expect(() => compile(`
      export function App() { let html = '<b>x</b>'; return <section innerHTML={html}>fallback</section>; }
    `)).toThrow('<section> sets innerHTML');
    expect(() => compile(`
      export function App() { let n = 1; return <my-card innerHTML="<b>x</b>">{n}</my-card>; }
    `)).toThrow('<my-card> sets innerHTML');
  });

  it('accepts innerHTML with only whitespace or comments inside', () => {
    expect(() => compile(`
      export function App() {
        return <div innerHTML="<b>x</b>">
          {/* filled by innerHTML */}
        </div>;
      }
    `)).not.toThrow();
  });

  it('leaves a component its own innerHTML prop', () => {
    expect(() => compile(`
      function Html({ innerHTML, children }) { return <div><div innerHTML={innerHTML} />{children}</div>; }
      export function App() { return <Html innerHTML="<b>x</b>"><i>y</i></Html>; }
    `)).not.toThrow();
  });
});
