/** `diagnoseModules` (`diagnose.ts`): the error that stops a program, as an editor reports it. */
import { describe, expect, it } from 'bun:test';
import { diagnoseModules } from './diagnose';

describe('diagnostics', () => {
  it('report nothing for a program that compiles', () => {
    expect(diagnoseModules({ './App.tsx': 'export function App() { return <p>hi</p>; }' })).toEqual([]);
  });

  it('report the error with its module and one-based place, without the prefix', () => {
    const diagnostics = diagnoseModules({
      './App.tsx': `import { Row } from './Row';\nexport function App() { return <Row a={1} />; }`,
      './Row.tsx': `export function Row(props, extra) {\n  return <p>{props.a}{extra}</p>;\n}`,
    });

    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic!.path).toBe('./Row.tsx');
    expect(diagnostic!.line).toBe(1);
    expect(diagnostic!.column).toBeGreaterThan(0);
    expect(diagnostic!.message).not.toStartWith('memo-dom:');
    expect(diagnostic!.message).toContain('<Row>');
  });

  it('report a syntax error at its place', () => {
    const [diagnostic] = diagnoseModules({ './App.tsx': 'export function App() {\n  return <p>{</p>;\n}' });
    expect(diagnostic!.path).toBe('./App.tsx');
    expect(diagnostic!.line).toBe(2);
  });
});
