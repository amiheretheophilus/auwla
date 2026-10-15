/** Compiler-owned page transport; readiness includes loading its allowlisted bindings. */
import { getActiveEnvironment, isPageContent, type PageContent } from '@memoized-dom/runtime';
import { getActiveDataRuntime } from './active-runtime';
import { enableRequestEncoding } from './request-encoding';
import { createStreamingSource } from './streaming';
import type { FetchOptions, ResolvedValue, StandardSchemaV1 } from './types';

type Loader = (id:string,key:string|undefined) => Promise<void>;
const validators = new WeakMap<Loader,StandardSchemaV1<unknown,PageContent>>();
export function createPageSource(target:string, options:FetchOptions, mode:'live'|undefined, loader:Loader): ResolvedValue<PageContent> {
  let validate = validators.get(loader);
  if (!validate) {
    validate = {'~standard':{version:1,vendor:'memoized-dom:page',async validate(input) {
      if (!isPageContent(input)) return {issues:[{message:'Invalid server page response'}]};
      // The host validates identities on both sides; only the browser imports bindings.
      await loader(input.id, getActiveEnvironment().mode.startsWith('server-') ? undefined : input.binding?.key);
      return {value:input};
    }}};
    validators.set(loader,validate);
  }
  const validated = {...options,validate};
  return mode ? createStreamingSource(target,validated,mode) : enableRequestEncoding(getActiveDataRuntime()).$fetch(target,validated) as unknown as ResolvedValue<PageContent>;
}
