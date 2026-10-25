/**
 * CPU profile of one DOM scenario in local Chrome: where the time goes.
 *
 *   bun run bench/dom/profile.ts --adapter=module-component --scenario="update 10k"
 *     [--compiler=next|old] [--runs=3] [--top=30]
 *
 * Uses the bundle `quick.ts` last built (`dist/quick-<compiler>.js`). Prepares
 * the scenario outside the profile, then records `--runs` runs and prints
 * functions by self time, and by inclusive time.
 */
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { domDirectory } from './bundle';

const flag = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const adapter = flag('adapter') ?? 'module-component';
const scenario = flag('scenario') ?? 'update 10k';
const compiler = flag('compiler') ?? 'next';
const runs = Number(flag('runs') ?? 3);
const top = Number(flag('top') ?? 30);

interface ProfileNode {
  id: number; callFrame: { functionName: string; url: string; lineNumber: number };
  hitCount?: number; children?: number[];
}

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/chromium');
const browser = await puppeteer.launch({
  executablePath, protocolTimeout: 600000, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><body></body></html>');
  await page.addScriptTag({ path: join(domDirectory, 'dist', `quick-${compiler}.js`) });
  const session = await page.createCDPSession();
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 100 });
  type Hooks = { __setup(id: string, name: string): void; __runOnce(id: string, name: string): void };
  let elapsed = 0;
  await session.send('Profiler.start');
  for (let run = 0; run < runs; run++) {
    await session.send('Profiler.stop').catch(() => {});
    await page.evaluate((id, name) => (window as unknown as Hooks).__setup(id, name), adapter, scenario);
    await session.send('Profiler.start');
    elapsed += await page.evaluate((id, name) => {
      const start = performance.now();
      (window as unknown as Hooks).__runOnce(id, name);
      return performance.now() - start;
    }, adapter, scenario);
  }
  const { profile } = await session.send('Profiler.stop') as unknown as {
    profile: { nodes: ProfileNode[]; startTime: number; endTime: number; samples: number[]; timeDeltas: number[] };
  };
  console.log(`${compiler} ${adapter} "${scenario}": ${(elapsed / runs).toFixed(1)} ms per run (last run profiled)`);

  // Self time per sample, attributed to function name + line.
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  const label = (node: ProfileNode) =>
    `${node.callFrame.functionName || '(anonymous)'}:${node.callFrame.lineNumber + 1}`;
  profile.samples.forEach((id, index) => {
    const time = (profile.timeDeltas[index] ?? 0) / 1000;
    const node = byId.get(id)!;
    self.set(label(node), (self.get(label(node)) ?? 0) + time);
    const seen = new Set<string>();
    for (let current: number | undefined = id; current !== undefined; current = parent.get(current)) {
      const name = label(byId.get(current)!);
      if (seen.has(name)) continue;
      seen.add(name);
      inclusive.set(name, (inclusive.get(name) ?? 0) + time);
    }
  });
  const print = (title: string, table: Map<string, number>) => {
    console.log(`\n${title}`);
    for (const [name, time] of [...table].sort((a, b) => b[1] - a[1]).slice(0, top)) {
      console.log(`${time.toFixed(1).padStart(9)} ms  ${name}`);
    }
  };
  print('self time', self);
  print('inclusive time', inclusive);
} finally {
  await browser.close();
}
