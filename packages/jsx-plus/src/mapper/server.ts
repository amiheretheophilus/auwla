import {
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import { CheckingProject } from './project';

// STDOUT belongs exclusively to the Content-Length framed JSON-RPC transport.
const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout),
);
const projects = new Map<string, CheckingProject>();
let initialized = false;

connection.onRequest('initialize', (params: { positionEncodings?: unknown }) => {
  // A malformed request gets a protocol error, not a crashed handler.
  if (!Array.isArray(params?.positionEncodings) || !params.positionEncodings.includes('utf-16')) {
    throw new ResponseError(-32602, 'The JSX+ prototype requires UTF-16 positions');
  }
  initialized = true;
  return { positionEncoding: 'utf-16', diagnosticSource: 'auwla' };
});

connection.onRequest('openProject', (params: { projectHandle: string; options?: Record<string, unknown> }) => {
  if (!initialized) {
    throw new ResponseError(-32002, 'Initialize the mapper before opening a project');
  }
  // Opening/reopening establishes a new configuration lifetime. No result is
  // shared with another handle or retained from a previous configuration.
  projects.set(params.projectHandle, new CheckingProject());
  return {
    optionDiagnostics: Object.keys(params.options ?? {}).map((name) => ({
      path: [name], messageText: `Unknown JSX+ mapper option '${name}'`, code: 1900,
    })),
  };
});

connection.onRequest('transform', (params: { projectHandle: string; fileName: string; content: string }) => {
  const project = projects.get(params.projectHandle);
  if (project === undefined) {
    throw new ResponseError(-32602, 'Unknown or closed mapper project');
  }
  return project.transform(params.content, params.fileName);
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
