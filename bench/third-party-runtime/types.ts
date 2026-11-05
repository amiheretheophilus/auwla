export const scenarios = ['local', 'shared', 'fetch'] as const;
export const phases = ['idle', 'updates', 'updates-frame'] as const;
export type Scenario = typeof scenarios[number];
export type Phase = typeof phases[number];
/** `opaque` and `compiled` use the old compiler; `next-opaque` is compiler-next with the original package. */
export type Mode = 'opaque' | 'compiled' | 'next-opaque';
export interface CaseConfig { scenario: Scenario; size: number; mode: Mode }
export interface Diagnostics {
  entities: number;
  volatileEntities: number;
  idleFrameCallbacks: number;
  idleRenders: number;
  idleTextWrites: number;
  updateRenders: number;
  updateTextWrites: number;
  requests: number;
}
export interface BrowserBenchmark {
  diagnose(): Promise<Diagnostics>;
  run(phase: Phase, operations: number): Promise<number>;
  close(): void;
}
declare global { interface Window { __thirdPartyBench: BrowserBenchmark } }
