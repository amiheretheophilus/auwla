import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';

export const packageRoot = fileURLToPath(new URL('..', import.meta.url));
export const exampleRoot = resolve(packageRoot, 'examples/checking');

// The integration probe deliberately runs the installed, pinned TS7 executable,
// independently of Bun's routine package type check and any editor installation.
const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}/package.json`;
export const typescriptExecutable = resolve(dirname(fileURLToPath(import.meta.resolve(platformPackage))),
  'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc');

export function rpcProcess(command: string, args: string[], cwd = packageRoot) {
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin),
  );
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const exited = new Promise<void>((done) => child.once('exit', () => {
    connection.dispose();
    done();
  }));
  connection.listen();

  return {
    connection,
    stderr: () => stderr,
    async close(languageServer = false) {
      if (languageServer && child.exitCode === null) {
        let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            connection.sendRequest('shutdown'),
            new Promise((_, reject) => {
              shutdownTimer = setTimeout(() => reject(new Error('Language server shutdown timed out')), 2000);
            }),
          ]);
          await connection.sendNotification('exit');
        } catch {
          // A failed startup or crashed server still needs its process closed.
        } finally {
          clearTimeout(shutdownTimer);
        }
      }
      connection.dispose();
      child.stdin.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([exited, new Promise<void>((done) => {
        timer = setTimeout(() => { child.kill(); done(); }, 2000);
      })]);
      clearTimeout(timer);
    },
  };
}

export interface Position { line: number; character: number }
export interface LspRange { start: Position; end: Position }
export interface TextEdit { range: LspRange; newText: string }

export function positionAt(source: string, offset: number): Position {
  const lines = source.slice(0, offset).split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
}

export function offsetAt(source: string, position: Position): number {
  let offset = 0;
  for (let line = 0; line < position.line; line++) offset = source.indexOf('\n', offset) + 1;
  return offset + position.character;
}
