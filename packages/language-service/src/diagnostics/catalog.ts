import {
  COMPILER_DIAGNOSTIC_CODE,
  COMPILER_DIAGNOSTIC_SOURCE as diagnosticSource,
} from '@memoized-dom/compiler-next';
export { diagnosticSource };

export const diagnosticCodes = {
  compiler: COMPILER_DIAGNOSTIC_CODE,
  preferConst: 98001,
} as const;

export function preferConstMessage(names: readonly string[]): string {
  const binding =
    names.length === 1
      ? `'${names[0]}' is`
      : `Bindings ${names.map((name) => `'${name}'`).join(', ')} are`;
  return (
    `${binding} never reassigned. Use const; memoized-dom reactivity follows ` +
    'state reads and assignments, not let declarations. const arrays and ' +
    'objects may still mutate their contents.'
  );
}
