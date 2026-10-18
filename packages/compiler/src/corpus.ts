/**
 * Differential-compilation corpus. With `MEMO_DOM_CORPUS=<dir>` set, every
 * public compile call whose arguments are plain JSON is written to `<dir>`
 * with its output, so a later compiler can replay the corpus and diff.
 * Off by default; it touches nothing without the variable.
 */
type Fs = { mkdirSync(path: string, options: { recursive: true }): void; writeFileSync(path: string, data: string): void };
type Crypto = { createHash(algorithm: string): { update(data: string): { digest(encoding: 'hex'): string } } };
type Process = { env: Record<string, string | undefined>; getBuiltinModule?(name: string): unknown };

const host = (globalThis as { process?: Process }).process;
const directory = host?.env.MEMO_DOM_CORPUS;

/** JSON text of `value`, or null when it holds anything JSON would drop or alter. */
function plainJson(value: unknown): string | null {
  let plain = true;
  const text = JSON.stringify(value, (_key, part: unknown) => {
    if (typeof part === 'function' || typeof part === 'symbol' || typeof part === 'bigint' ||
      part instanceof Map || part instanceof Set || part instanceof RegExp) plain = false;
    return part;
  });
  return plain && text !== undefined ? text : null;
}

export function recordCompile<T>(api: string, args: readonly unknown[], result: T): T {
  if (directory === undefined || host?.getBuiltinModule === undefined) return result;
  const input = plainJson(args);
  if (input === null) return result;
  const fs = host.getBuiltinModule('node:fs') as Fs;
  const crypto = host.getBuiltinModule('node:crypto') as Crypto;
  const name = crypto.createHash('sha1').update(api + '\0' + input).digest('hex');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(`${directory}/${name}.json`, JSON.stringify({ api, args: JSON.parse(input), result }));
  return result;
}
