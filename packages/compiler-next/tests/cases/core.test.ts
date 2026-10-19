/**
 * Cases for wiki/compiler/core.md.
 */
import { behaves } from '../harness/run';

behaves('a TypeScript enum', {
  source: `
    enum Mode { A, B }
    export function App() {
      let mode = Mode.A;
      return <main><p>{mode === Mode.A ? 'A' : 'B'}</p><button onClick={() => (mode = Mode.B)}>b</button></main>;
    }`,
  steps: [{ click: 'button' }],
});
