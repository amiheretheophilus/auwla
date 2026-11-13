import { compile as compileNext, type CompileOptions } from '@memoized-dom/compiler-next';
import { auwla } from './language';

/**
 * One module through compiler-next, with `.auwla` among its languages (`language.ts`). Compiler-next
 * reports every error at the authored `.auwla` position: syntax errors as `JsxPlusError`, later ones
 * moved back from the normalized TSX. A `.tsx` `moduleId` keeps its existing JSX meaning.
 */
export function compile(source: string, options: CompileOptions = {}): string {
  return compileNext(source, {
    ...options,
    moduleId: options.moduleId ?? './App.auwla',
    languages: [auwla, ...(options.languages ?? [])],
  });
}
