import { expect, it } from 'bun:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('loads the built extension outside the workspace and runs CSS providers in Node', async () => {
  const root = resolve(import.meta.dir, '..');
  const build = Bun.spawn([process.execPath, 'run', 'scripts/build.ts'], {
    cwd: root, stdout: 'pipe', stderr: 'pipe',
  });
  const [code, buildErrors] = await Promise.all([build.exited, new Response(build.stderr).text()]);
  expect(buildErrors).toBe('');
  expect(code).toBe(0);

  const installed = mkdtempSync(join(tmpdir(), 'auwla-css-bundle-'));
  try {
    const entry = join(installed, 'extension.cjs');
    copyFileSync(join(root, 'dist/extension.cjs'), entry);
    const host = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [exitCode, output, errors] = await Promise.all([
      host.exited, new Response(host.stdout).text(), new Response(host.stderr).text(),
    ]);
    expect(errors).toBe('');
    expect(exitCode).toBe(0);
    expect(output).toContain('completion, hover and diagnostics passed in Node');
    expect(output).toContain('Reactivity hints passed in Node');

    // The test's own copies of example apps (`fixtures/apps/`), never the examples themselves.
    const example = join(import.meta.dir, 'fixtures/apps/class-conditions/App.auwla');
    const real = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, example], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [realExit, realOutput, realErrors] = await Promise.all([
      real.exited, new Response(real.stdout).text(), new Response(real.stderr).text(),
    ]);
    expect(realErrors).toBe('');
    expect(realExit).toBe(0);
    expect(realOutput).toContain('zero CSS diagnostics and native value completion passed');

    const cards = join(import.meta.dir, 'fixtures/apps/scoping/Cards.auwla');
    const scoped = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, cards], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [scopeExit, scopeOutput, scopeErrors] = await Promise.all([
      scoped.exited, new Response(scoped.stdout).text(), new Response(scoped.stderr).text(),
    ]);
    expect(scopeErrors).toBe('');
    expect(scopeExit).toBe(0);
    expect(scopeOutput).toContain('zero CSS diagnostics and native value completion passed');

    const responsive = join(import.meta.dir, 'fixtures/apps/responsive/shared.auwla');
    const numeric = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, responsive, '@700:'], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [numericExit, numericOutput, numericErrors] = await Promise.all([
      numeric.exited, new Response(numeric.stdout).text(), new Response(numeric.stderr).text(),
    ]);
    expect(numericErrors).toBe('');
    expect(numericExit).toBe(0);
    expect(numericOutput).toContain('zero CSS diagnostics and native value completion passed');

    const grouped = join(import.meta.dir, 'fixtures/apps/style-groups/Card.auwla');
    const group = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, grouped, 'color: '], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [groupExit, groupOutput, groupErrors] = await Promise.all([
      group.exited, new Response(group.stdout).text(), new Response(group.stderr).text(),
    ]);
    expect(groupErrors).toBe('');
    expect(groupExit).toBe(0);
    expect(groupOutput).toContain('zero CSS diagnostics and native value completion passed');

    const consumer = join(import.meta.dir, 'fixtures/apps/style-sources/Card.auwla');
    const sources = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, consumer, '--sources'], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [sourceExit, sourceOutput, sourceErrors] = await Promise.all([
      sources.exited, new Response(sources.stdout).text(), new Response(sources.stderr).text(),
    ]);
    expect(sourceErrors).toBe('');
    expect(sourceExit).toBe(0);
    expect(sourceOutput).toContain('Cross-file CSS: path/ID completion and diagnostic refresh passed in Node');
  } finally {
    rmSync(installed, { recursive: true, force: true });
  }
}, 30_000);
