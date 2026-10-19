/**
 * Cases for wiki/compiler/components.md.
 */
import { behaves } from '../harness/run';

behaves('a member expression as a tag', {
  source: `
    const UI = { Box: ({ children }) => <div class="box">{children}</div> };
    export function App() {
      return <UI.Box>inside</UI.Box>;
    }`,
});

behaves('an extra prop the child does not declare', {
  source: `
    function Child({ a }) {
      return <p>{a}</p>;
    }
    export function App() {
      return <Child a={1} b={2} />;
    }`,
});

behaves('a prop follows the parent', {
  source: `
    function Label({ text }) {
      return <p>{text}</p>;
    }
    export function App() {
      let name = 'a';
      return <main><Label text={name} /><button onClick={() => (name = 'b')}>set</button></main>;
    }`,
  steps: [{ click: 'button' }],
});
