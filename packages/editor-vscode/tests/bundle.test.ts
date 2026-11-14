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

    const example = join(root, '../jsx-plus/examples/class-conditions/App.auwla');
    const real = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, example], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [realExit, realOutput, realErrors] = await Promise.all([
      real.exited, new Response(real.stdout).text(), new Response(real.stderr).text(),
    ]);
    expect(realErrors).toBe('');
    expect(realExit).toBe(0);
    expect(realOutput).toContain('zero CSS diagnostics and native value completion passed');

    const cards = join(root, '../jsx-plus/examples/scoping/Cards.auwla');
    const scoped = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, cards], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [scopeExit, scopeOutput, scopeErrors] = await Promise.all([
      scoped.exited, new Response(scoped.stdout).text(), new Response(scoped.stderr).text(),
    ]);
    expect(scopeErrors).toBe('');
    expect(scopeExit).toBe(0);
    expect(scopeOutput).toContain('zero CSS diagnostics and native value completion passed');

    const responsive = join(root, '../jsx-plus/examples/responsive/shared.auwla');
    const numeric = Bun.spawn(['node', join(import.meta.dir, 'fixtures/bundle-host.cjs'), entry, responsive, '@700:'], {
      cwd: installed, stdout: 'pipe', stderr: 'pipe',
    });
    const [numericExit, numericOutput, numericErrors] = await Promise.all([
      numeric.exited, new Response(numeric.stdout).text(), new Response(numeric.stderr).text(),
    ]);
    expect(numericErrors).toBe('');
    expect(numericExit).toBe(0);
    expect(numericOutput).toContain('zero CSS diagnostics and native value completion passed');
  } finally {
    rmSync(installed, { recursive: true, force: true });
  }
}, 30_000);
