import { createApplicationRuntime, runWithApplicationRuntime, setActiveApplicationRuntime, setScheduler, type ApplicationRuntime } from '@memoized-dom/runtime';
import { createDataRuntime, setActiveDataRuntime, type DataRuntime } from '@memoized-dom/data';
import type { BrowserBenchmark, CaseConfig, Diagnostics, Phase } from './types';

/** Actual production runtime/DOM. Frames are explicitly pumped, not wall-clock RAF waits. */
export function installBenchmark(App: (id: string, parent: null) => Node, config: CaseConfig): void {
  let owner: ApplicationRuntime | undefined, data: DataRuntime | undefined, previous: DataRuntime | undefined;
  let previousOwner: ApplicationRuntime | undefined;
  let frames: Array<() => void> = [], outputs: HTMLOutputElement[] = [], buttons: HTMLButtonElement[] = [];
  let before: number[] = [], requests = 0, draft: HTMLInputElement;
  let countFrames = false, frameCallbacks = 0;
  const close = () => {
    owner?.dispose(); owner = undefined;
    data?.clear(); data = undefined;
    if (previous) setActiveDataRuntime(previous); previous = undefined;
    if (previousOwner) setActiveApplicationRuntime(previousOwner); previousOwner = undefined;
    frames = []; document.body.replaceChildren();
  };
  const prepare = async () => {
    close(); requests = 0;
    if (document.hidden) throw new Error('Benchmark tab is hidden; opaque pulling would be incorrectly skipped');
    owner = createApplicationRuntime('ThirdPartyBench', { document, schedule: run => frames.push(run) });
    // One active browser app owns the whole trial, including async data delivery.
    // A short synchronous request scope would restore the wrong app before fetch settles.
    previousOwner = setActiveApplicationRuntime(owner);
    data = createDataRuntime({ fetch: async () => { requests++; return Response.json({ user: { count: 0 } }); } });
    previous = setActiveDataRuntime(data);
    runWithApplicationRuntime(owner, () => { setScheduler(run => run()); document.body.append(App('App', null)); });
    const deadline = performance.now() + 30_000;
    for (;;) {
      outputs = [...document.querySelectorAll<HTMLOutputElement>('[data-value]')];
      if (outputs.length === config.size && outputs.every(output => output.textContent !== '')) break;
      if (performance.now() > deadline) throw new Error('Initial data/DOM did not become ready');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    outputs.sort((a, b) => Number(a.dataset.value) - Number(b.dataset.value));
    buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-change]')]
      .sort((a, b) => Number(a.dataset.change) - Number(b.dataset.change));
    if (buttons.length !== config.size) throw new Error('Wrong number of mutation buttons');
    before = outputs.map(output => Number(output.textContent));
    if (before.some(value => !Number.isFinite(value))) throw new Error('Non-numeric initial output');
    draft = document.querySelector<HTMLInputElement>('#draft')!; draft.value = 'retain this draft';
    if (requests !== (config.scenario === 'fetch' ? config.size : 0)) throw new Error(`Unexpected initial request count ${requests}`);
  };
  const frame = () => {
    // Snapshot before running: the volatile driver schedules the NEXT frame.
    const batch = frames; frames = [];
    if (countFrames) frameCallbacks += batch.length;
    for (const callback of batch) callback();
  };
  const execute = (phase: Phase, operations: number) => {
    runWithApplicationRuntime(owner!, () => {
      for (let index = 0; index < operations; index++) {
        if (phase !== 'idle') buttons[index % buttons.length]!.click();
        if (phase !== 'updates') frame();
      }
    });
  };
  const verify = (phase: Phase, operations: number) => {
    for (let index = 0; index < outputs.length; index++) {
      const hits = phase === 'idle' ? 0 : Math.floor(operations / config.size) + (index < operations % config.size ? 1 : 0);
      if (outputs[index]!.textContent !== String(before[index]! + hits)) throw new Error(`Stale/wrong output at row ${index}`);
      if (document.querySelector(`[data-value="${index}"]`) !== outputs[index]) throw new Error('Update replaced an output node');
    }
    if (document.querySelector('#draft') !== draft || draft.value !== 'retain this draft') throw new Error('Update lost local input state');
    if (requests !== (config.scenario === 'fetch' ? config.size : 0)) throw new Error('Update issued another data request');
  };
  const benchmark: BrowserBenchmark = {
    async diagnose() {
      await prepare();
      const result: Diagnostics = {
        entities: owner!.state.registry.size,
        volatileEntities: [...owner!.state.registry.values()].filter(entity => entity.volatile === true).length,
        idleFrameCallbacks: 0, idleRenders: 0, idleTextWrites: 0, updateRenders: 0, updateTextWrites: 0, requests: 0,
      };
      let renders = 0, writes = 0;
      // Counters are installed ONLY for this untimed correctness/diagnostic run.
      for (const entity of owner!.state.registry.values()) {
        const render = entity.render; entity.render = reasons => { renders++; render(reasons); };
      }
      const descriptor = Object.getOwnPropertyDescriptor(CharacterData.prototype, 'data')!;
      if (!descriptor.set) throw new Error('Cannot instrument CharacterData.data');
      Object.defineProperty(CharacterData.prototype, 'data', { ...descriptor, set(value: string) { writes++; descriptor.set!.call(this, value); } });
      try {
        countFrames = true; frameCallbacks = 0;
        execute('idle', 5); verify('idle', 5);
        result.idleRenders = renders; result.idleTextWrites = writes; result.idleFrameCallbacks = frameCallbacks;
        if (writes !== 0) throw new Error('Idle checking unexpectedly wrote text');
        renders = writes = 0;
        execute('updates-frame', config.size); verify('updates-frame', config.size);
        result.updateRenders = renders; result.updateTextWrites = writes; result.requests = requests;
        if (writes !== config.size) throw new Error('Expected exactly one guarded text write per increment');
        return result;
      } finally {
        countFrames = false; Object.defineProperty(CharacterData.prototype, 'data', descriptor); close();
      }
    },
    async run(phase, operations) {
      await prepare(); // Setup, data settlement and verification are outside timing.
      const start = performance.now(); execute(phase, operations); const elapsed = performance.now() - start;
      verify(phase, operations); close(); return elapsed;
    },
    close,
  };
  window.__thirdPartyBench = benchmark;
}
