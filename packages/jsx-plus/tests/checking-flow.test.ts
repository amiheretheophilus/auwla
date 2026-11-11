import { expect, it } from 'bun:test';
import { probeCheckingFlow } from './probe-flow';

it('checks every declared flow target through the real mapper and TypeScript LSP', async () => {
  const report = await probeCheckingFlow();
  for (const result of report.results) {
    expect({ id: result.id, diagnostics: result.observed }).toEqual({ id: result.id, diagnostics: result.expected });
  }
  // Catalog acceptance is distinct from complete TOOL-05 language acceptance.
}, 20000);
