import { expect, it } from 'bun:test';
import { probeCheckingFlow } from './probe-flow';

it('preserves the established ref, row, shadowing and synchronous flow cases', async () => {
  const report = await probeCheckingFlow();
  for (const result of report.results.filter((entry) => entry.coverage === 'baseline')) {
    expect({ id: result.id, diagnostics: result.observed }).toEqual({ id: result.id, diagnostics: result.expected });
  }
  // The full catalog includes target contracts that the current projection does
  // not meet. Do not assert those bugs as correct or quietly call this full
  // TOOL-05 acceptance. The strict probe is the separate, intentionally red gate.
  console.log(`TOOL-05 probe: ${report.results.filter((entry) => !entry.matches).length} unmet contracts; full flow acceptance NOT CLAIMED`);
}, 20000);
