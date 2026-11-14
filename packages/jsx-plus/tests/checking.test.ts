import { expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SpanMap, SpanMapFeature } from 'typescript/ast';
import { projectForChecking, type CheckingSource } from '../src/checking/project';
import { checkingRoot, packageRoot, positionAt, rpcProcess, typescriptExecutable } from './rpc';

it('projects exact copied spans and excludes generated syntax from editable mappings', () => {
  const source = '<p>"😀 "; title.toFixed(2)</p>';
  const result = projectForChecking(source, './App.auwla');
  expect(result.text).toBe('<p>{"😀 "}{title.toFixed(2)}</p>');
  const map = new SpanMap(result.mappings.map(([virtualStart, virtualLength, originalStart, originalLength, kind]) => ({
    virtualStart, virtualEnd: virtualStart + virtualLength,
    originalStart, originalEnd: originalStart + originalLength, kind,
  })));

  for (const [virtualStart, virtualLength, originalStart, originalLength] of result.mappings) {
    expect(virtualLength).toBe(originalLength);
    expect(result.text.slice(virtualStart, virtualStart + virtualLength))
      .toBe(source.slice(originalStart, originalStart + originalLength));
  }
  const identifier = result.text.indexOf('title');
  const mapped = map.virtualToOriginalSpanForFeature({ pos: identifier, end: identifier + 5 }, SpanMapFeature.Rename);
  expect(SpanMap.isExact(mapped.fidelity)).toBe(true);
  expect(mapped.range).toEqual({ pos: source.indexOf('title'), end: source.indexOf('title') + 5 });
  const brace = result.text.indexOf('{');
  const generated = map.virtualToOriginalSpanForFeature({ pos: brace, end: brace + 1 }, SpanMapFeature.Rename);
  expect(SpanMap.isExact(generated.fidelity)).toBe(false);
});

it('maps the end of an expression before generated braces back exactly', () => {
  // Auto-import edits need the cursor after `focusTask` to have an exact authored
  // counterpart, although the next virtual character is a generated `}`.
  for (const source of ['<b onClick=focusTask>"x"</b>', '<p>focusTask</p>']) {
    const result = projectForChecking(source, './App.auwla');
    const map = new SpanMap(result.mappings.map(([virtualStart, virtualLength, originalStart, originalLength, kind]) => ({
      virtualStart, virtualEnd: virtualStart + virtualLength,
      originalStart, originalEnd: originalStart + originalLength, kind,
    })));
    const virtualEnd = result.text.indexOf('focusTask') + 'focusTask'.length;
    expect(result.text[virtualEnd]).toBe('}');
    const mapped = map.virtualToOriginalPosition(virtualEnd);
    expect(SpanMap.isExact(mapped.fidelity)).toBe(true);
    expect(mapped.position).toBe(source.indexOf('focusTask') + 'focusTask'.length);

    // The generated brace itself still has no editable authored text.
    const brace = map.virtualToOriginalSpanForFeature({ pos: virtualEnd, end: virtualEnd + 1 }, SpanMapFeature.Rename);
    expect(SpanMap.isExact(brace.fidelity)).toBe(false);
  }
});

it('returns an authored parse diagnostic without claiming to check an incomplete file', () => {
  const result = projectForChecking('<p>"missing', './App.auwla');
  expect(result.text).toBe('export {};\n');
  expect(result.mappings).toEqual([]);
  // Editors place the message themselves, so it carries no file:line:column.
  expect(result.diagnostics).toEqual([{
    messageText: 'Unterminated child string or template [JPX1003]', start: 3, length: 1, code: 1003,
  }]);
});

it('serves independent mapper projects and rejects closed handles', async () => {
  const peer = rpcProcess(process.execPath, ['run', 'src/mapper/server.ts']);
  try {
    await expect(peer.connection.sendRequest('openProject', { projectHandle: 'early' })).rejects.toThrow('Initialize');
    await expect(peer.connection.sendRequest('initialize', { positionEncodings: ['utf-8'] })).rejects.toThrow('UTF-16');
    await expect(peer.connection.sendRequest('initialize', {})).rejects.toThrow('UTF-16');
    expect(await peer.connection.sendRequest('initialize', { positionEncodings: ['utf-8', 'utf-16'] }))
      .toEqual({ positionEncoding: 'utf-16', diagnosticSource: 'auwla' });
    for (const projectHandle of ['one', 'two']) {
      expect(await peer.connection.sendRequest('openProject', { projectHandle, configFileName: '', compilerOptions: {} }))
        .toEqual({ optionDiagnostics: [] });
    }
    expect(await peer.connection.sendRequest('openProject', { projectHandle: 'options', options: { unknown: true } }))
      .toEqual({ optionDiagnostics: [{ path: ['unknown'], messageText: "Unknown JSX+ mapper option 'unknown'", code: 1900 }] });
    const transform = (projectHandle: string, content: string) => peer.connection.sendRequest<CheckingSource>('transform', {
      projectHandle, fileName: '/App.auwla', content,
    });
    expect((await transform('one', '<p>"one"</p>')).text).toBe('<p>{"one"}</p>');
    const incomplete = await transform('two', '<p>"missing');
    expect(incomplete.diagnostics?.[0]).toMatchObject({ code: 1003, start: 3, length: 1 });
    await peer.connection.sendRequest('closeProject', { projectHandle: 'one' });
    await expect(transform('one', '<p>"closed"</p>')).rejects.toThrow('Unknown or closed');
    expect((await transform('two', '<p>"two"</p>')).text).toBe('<p>{"two"}</p>');
    await peer.connection.sendRequest('openProject', { projectHandle: 'one', configFileName: '', compilerOptions: {} });
    expect((await transform('one', '<p>"again"</p>')).text).toBe('<p>{"again"}</p>');
  } finally {
    await peer.close();
  }
}, 15000);

it('runs the real TypeScript CLI with an authored Unicode error location', async () => {
  const check = async (config: string, allowMapper = true) => {
    const permission = allowMapper ? ['--runExternalCode'] : [];
    const child = Bun.spawn([typescriptExecutable, '--project', resolve(checkingRoot, config), ...permission, '--pretty', 'false'], {
      cwd: packageRoot, stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { output: stdout + stderr, exitCode };
  };
  expect(await check('tsconfig.json')).toEqual({ output: '', exitCode: 0 });
  expect(await check('../task-board/tsconfig.json')).toEqual({ output: '', exitCode: 0 });
  const source = readFileSync(resolve(checkingRoot, 'TypeError.auwla'), 'utf8');
  const position = positionAt(source, source.indexOf('toFixed'));
  const result = await check('tsconfig.error.json');
  expect(result.exitCode).toBe(2);
  // TS2551 includes the native suggestion for string.fixed(); the mapper must
  // preserve TypeScript's diagnostic rather than replace it with its own code.
  expect(result.output).toContain(`TypeError.auwla(${position.line + 1},${position.character + 1}): error TS2551`);
  expect(result.output).not.toContain('code generated by');
  const denied = await check('tsconfig.json', false);
  expect(denied.exitCode).toBe(2);
  expect(denied.output).toContain('TS18068');
}, 20000);
