/** Optional isolation for compiler calls that may synchronously loop. Test-only. */
import { compileModules } from '@memoized-dom/compiler';

const modules = JSON.parse(await Bun.stdin.text()) as Record<string, string>;
const output = compileModules(modules, { runtimePath: '@memoized-dom/runtime/testing' });
await Bun.write(Bun.stdout, JSON.stringify(output));
