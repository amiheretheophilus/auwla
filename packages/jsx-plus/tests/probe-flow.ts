import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import catalog from './fixtures/checking-flow.json';
import { exampleRoot, offsetAt, rpcProcess, typescriptExecutable, type LspRange } from './rpc';

interface Expectation { code: number; text: string; occurrence?: number }
interface FlowCase {
  id: string;
  topic: string;
  coverage: string;
  source: string;
  expected: Expectation[];
}
interface Diagnostic { code: number | string; message: string; range: LspRange; severity: number }
interface DiagnosticSpan { code: number | string; start: number; end: number }

function expectedSpan(source: string, expected: Expectation): DiagnosticSpan {
  let start = -1;
  for (let occurrence = 0; occurrence <= (expected.occurrence ?? 0); occurrence++) {
    start = source.indexOf(expected.text, start + 1);
    if (start < 0) throw new Error(`Missing expected token '${expected.text}' in flow fixture`);
  }
  return { code: expected.code, start, end: start + expected.text.length };
}

/** A probe reports unmet contracts; it never turns current bugs into expectations. */
export async function probeCheckingFlow(cases: readonly FlowCase[] = catalog.cases) {
  const uri = pathToFileURL(resolve(exampleRoot, 'App.auwla')).href;
  const peer = rpcProcess(typescriptExecutable, ['--lsp', '--stdio'], exampleRoot);
  peer.connection.onRequest('client/registerCapability', () => null);
  const results: {
    id: string; topic: string; coverage: string; matches: boolean;
    expected: DiagnosticSpan[]; observed: DiagnosticSpan[]; messages: string[];
  }[] = [];

  try {
    const initialization = await peer.connection.sendRequest<{ serverInfo: { version: string } }>('initialize', {
      processId: process.pid, rootUri: pathToFileURL(exampleRoot).href,
      capabilities: { general: { positionEncodings: ['utf-16'] }, textDocument: { diagnostic: {} } },
      initializationOptions: { runExternalCode: true },
    });
    await peer.connection.sendNotification('initialized', {});

    for (const [index, fixture] of cases.entries()) {
      if (index === 0) {
        await peer.connection.sendNotification('textDocument/didOpen', {
          textDocument: { uri, languageId: 'auwla', version: 1, text: fixture.source },
        });
      } else {
        await peer.connection.sendNotification('textDocument/didChange', {
          textDocument: { uri, version: index + 1 }, contentChanges: [{ text: fixture.source }],
        });
      }
      const report = await peer.connection.sendRequest<{ items: Diagnostic[] }>('textDocument/diagnostic', { textDocument: { uri } });
      const errors = report.items.filter((entry) => entry.severity === 1);
      const observed = errors.map((entry) => ({
        code: entry.code,
        start: offsetAt(fixture.source, entry.range.start), end: offsetAt(fixture.source, entry.range.end),
      })).sort((a, b) => a.start - b.start);
      const expected = fixture.expected.map((entry) => expectedSpan(fixture.source, entry)).sort((a, b) => a.start - b.start);
      results.push({
        id: fixture.id, topic: fixture.topic, coverage: fixture.coverage,
        matches: JSON.stringify(observed) === JSON.stringify(expected),
        expected, observed, messages: errors.map((entry) => entry.message),
      });
    }

    return { typescriptVersion: initialization.serverInfo.version, results };
  } finally {
    await peer.close(true);
  }
}

if (import.meta.main) {
  // Fail fast if invoked from an unexpected checkout without its mapper config.
  readFileSync(resolve(exampleRoot, 'tsconfig.json'), 'utf8');
  const report = await probeCheckingFlow();
  for (const result of report.results) {
    console.log(`${result.id}: ${result.matches ? 'MATCH' : 'GAP'} — ${result.topic}`);
    if (!result.matches) console.log(JSON.stringify({ expected: result.expected, observed: result.observed, messages: result.messages }));
  }
  const gaps = report.results.filter((result) => !result.matches).map((result) => result.id);
  console.log(JSON.stringify({
    typescriptVersion: report.typescriptVersion, fixtures: report.results.length,
    catalogStatus: gaps.length === 0 ? 'PASS' : 'NOT PASSING', gaps,
    tool05Acceptance: 'NOT CLAIMED',
    mode: process.argv.includes('--strict') ? 'strict acceptance' : 'observation only',
  }));
  if (process.argv.includes('--strict') && gaps.length > 0) process.exitCode = 1;
}
