import {
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import type { CheckingProject } from './project';

// STDOUT belongs exclusively to the Content-Length framed JSON-RPC transport.
const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const projects = new Map<string, Promise<CheckingProject>>();
let initialized = false;

/**
 * The checker, loaded when the first project opens. Loading it compiles the compiler's sources,
 * which takes seconds on a busy machine, and TypeScript gives up on a mapper that does not answer
 * `initialize` within 5 seconds (TS18099). No other request has a time limit.
 */
let checking: Promise<typeof import('./project')> | null = null;

function newProject(): Promise<CheckingProject> {
  checking ??= import('./project');
  return checking.then(({ CheckingProject }) => new CheckingProject());
}

connection.onRequest('initialize', (params: { positionEncodings?: unknown }) => {
  // A malformed request gets a protocol error, not a crashed handler.
  if (!Array.isArray(params?.positionEncodings) || !params.positionEncodings.includes('utf-16')) {
    throw new ResponseError(-32602, 'The JSX+ prototype requires UTF-16 positions');
  }
  initialized = true;
  return { positionEncoding: 'utf-16', diagnosticSource: 'auwla' };
});

connection.onRequest('openProject', async (params: { projectHandle: string; options?: Record<string, unknown> }) => {
  if (!initialized) {
    throw new ResponseError(-32002, 'Initialize the mapper before opening a project');
  }
  // Opening/reopening establishes a new configuration lifetime. No result is
  // shared with another handle or retained from a previous configuration.
  const project = newProject();
  projects.set(params.projectHandle, project);
  await project;
  return {
    optionDiagnostics: Object.keys(params.options ?? {}).map((name) => ({
      path: [name], messageText: `Unknown JSX+ mapper option '${name}'`, code: 1900,
    })),
  };
});

connection.onRequest('transform', async (params: { projectHandle: string; fileName: string; content: string }) => {
  const project = projects.get(params.projectHandle);
  if (project === undefined) {
    throw new ResponseError(-32602, 'Unknown or closed mapper project');
  }
  return (await project).transform(params.content, params.fileName);
});

connection.onRequest('closeProject', (params: { projectHandle: string }) => {
  projects.delete(params.projectHandle);
  return null;
});

connection.onClose(() => {
  projects.clear();
  connection.dispose();
});
connection.listen();
