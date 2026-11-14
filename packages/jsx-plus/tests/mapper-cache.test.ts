import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { projectForChecking } from '../src/checking/project';
import { CheckingProject } from '../src/mapper/project';

const source = readFileSync(new URL('./fixtures/apps/task-board/App.auwla', import.meta.url), 'utf8');

function measuredProject() {
  let computations = 0;
  const project = new CheckingProject((content, fileName) => {
    computations++;
    return projectForChecking(content, fileName);
  });
  return { project, computations: () => computations };
}

it('reuses the actual task-board projection only for the latest exact file and content', () => {
  const measured = measuredProject();
  const project = measured.project;
  const original = project.transform(source, '/App.auwla');
  expect(original.supplemental).toHaveLength(1);
  expect(project.transform(source, '/App.auwla')).toBe(original);
  expect(measured.computations()).toBe(1);

  const editedSource = source.replace('Make room for the next idea.', 'Plan the next release.');
  const edited = project.transform(editedSource, '/App.auwla');
  expect(edited.text).toContain('Plan the next release.');
  expect(edited).not.toBe(original);
  expect(project.transform(editedSource, '/App.auwla')).toBe(edited);
  expect(measured.computations()).toBe(2);

  // Undo and file switches recompute: this cache retains no earlier revisions.
  const restored = project.transform(source, '/App.auwla');
  expect(restored).not.toBe(original);
  expect(restored).toEqual(original);
  project.transform(source, '/Other.auwla');
  project.transform(source, '/App.auwla');
  expect(measured.computations()).toBe(5);
});

it('reuses authored parse diagnostics and replaces them after the next real edit', () => {
  const measured = measuredProject();
  const incomplete = '<p>"missing';
  const broken = measured.project.transform(incomplete, '/App.auwla');
  expect(broken.diagnostics?.[0]).toMatchObject({ code: 1003, start: 3, length: 1 });
  expect(measured.project.transform(incomplete, '/App.auwla')).toBe(broken);
  expect(measured.computations()).toBe(1);

  const restored = measured.project.transform(source, '/App.auwla');
  expect(restored.diagnostics).toBeUndefined();
  expect(restored.text).toContain('task-board');
  expect(measured.computations()).toBe(2);
});

it('keeps identical authored files independent across project lifetimes', () => {
  const first = measuredProject();
  const second = measuredProject();
  const a = first.project.transform(source, '/App.auwla');
  const b = second.project.transform(source, '/App.auwla');

  expect(b).toEqual(a);
  expect(b).not.toBe(a);
  expect(first.project.transform(source, '/App.auwla')).toBe(a);
  expect(first.computations()).toBe(1);
  expect(second.computations()).toBe(1);
});
