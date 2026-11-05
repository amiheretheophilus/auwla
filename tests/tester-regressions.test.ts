import { describe, expect, it } from 'bun:test';
import {
  compileModules,
  diagnose,
  diagnoseModules,
} from '@memoized-dom/compiler';

describe('external tester regressions', () => {
  it('allows a Group to provide policy for sources owned by descendant components', () => {
    expect(() => compileModules({
      './app.tsx': `
        import { $fetch, Group } from '@memoized-dom/data';
        function Loading() { return <p>Loading</p>; }
        function Failed({ error, retry }) { return <button onClick={retry}>{error.message}</button>; }
        function Sidebar() {
          const projects = $fetch('/projects');
          return <ul>{projects.map(project => <li key={project.id}>{project.name}</li>)}</ul>;
        }
        export function App() {
          return (
            <Group pending={Loading} error={Failed}>
              <main><Sidebar /></main>
            </Group>
          );
        }
      `,
    })).not.toThrow();
  });

  it('accepts a pure visible helper call as a local collection derivation', () => {
    expect(() => compileModules({
      './app.tsx': `
        import { $fetch } from '@memoized-dom/data';
        function buildRows(projects, tasks) {
          return projects.map(project => ({
            project,
            total: tasks.filter(task => task.projectId === project.id).length,
          }));
        }
        export function App() {
          const projects = $fetch('/projects');
          const tasks = $fetch('/tasks');
          const rows = buildRows(projects, tasks);
          return <ul>{rows.map(row => <li key={row.project.id}>{row.total}</li>)}</ul>;
        }
      `,
    })).not.toThrow();
  });

  it('accepts a conditional expression as a local collection derivation', () => {
    expect(() => compileModules({
      './app.tsx': `
        import { $fetch } from '@memoized-dom/data';
        export function App() {
          let query = '';
          const projects = $fetch('/projects');
          const needle = query.trim().toLowerCase();
          const hits = needle === ''
            ? []
            : projects.filter(project => project.name.includes(needle)).slice(0, 4);
          return <ul>{hits.map(project => <li key={project.id}>{project.name}</li>)}</ul>;
        }
      `,
    })).not.toThrow();
  });

  // A key outside a list follows React since 2026-10-19 (`stray-keys.test.ts`), so this
  // is no longer reported. It used to check that the report pointed at the attribute.
  it('reports no misplaced key for a literal key outside a list', () => {
    const diagnostics = diagnose(
      'export function Card() {\n' +
      '  return (\n' +
      '    <article\n' +
      '      key={"one"}\n' +
      '    >Card</article>\n' +
      '  );\n' +
      '}\n',
      { moduleId: './Card.tsx' },
    );
    expect(diagnostics).toEqual([]);
  });

  it('points a missing linked export diagnostic at its import specifier', () => {
    const diagnostic = diagnoseModules({
      './ui-state.ts': 'function dismissToast() {}\n',
      './ToastStack.tsx':
        "import { dismissToast } from './ui-state';\n" +
        'export function ToastStack() {\n' +
        '  return <button onClick={dismissToast}>Dismiss</button>;\n' +
        '}\n',
    })[0];
    expect(diagnostic).toMatchObject({
      moduleId: './ToastStack.tsx',
      line: 1,
    });
  });
});
