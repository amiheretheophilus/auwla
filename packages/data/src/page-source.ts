/** Compiler-owned page transport; readiness includes loading its allowlisted bindings. */
import { acceptPageContent, decodePageHtml, getActiveEnvironment, isPageContent, type PageContent } from '@memoized-dom/runtime';
import { getActiveDataRuntime } from './active-runtime';
import { enableRequestEncoding } from './request-encoding';
import { createStreamingSource } from './streaming';
import { registerCompilerTransferContract } from './request-transfer';
import { registerResponseDecoder } from './response-decoder';
import type { FetchOptions, ResolvedValue, StandardSchemaV1 } from './types';

type Loader = (id:string,key:string|undefined) => Promise<void> | void;
const validators = new WeakMap<Loader,StandardSchemaV1<unknown,PageContent>>();
export function createPageSource(target:string, options:FetchOptions, mode:'live'|undefined, loader:Loader): ResolvedValue<PageContent> {
  let validate = validators.get(loader);
  if (!validate) {
    validate = {'~standard':{version:1,vendor:'memoized-dom:page',validate(input) {
      if (!isPageContent(input)) return {issues:[{message:'Invalid server page response'}]};
      // The host validates identities on both sides; only the browser imports bindings.
      const loaded=loader(input.id, getActiveEnvironment().mode.startsWith('server-') ? undefined : input.binding?.key);
      return loaded ? loaded.then(()=>({value:acceptPageContent(input)})) : {value:acceptPageContent(input)};
    }}};
    validators.set(loader,validate);
    registerCompilerTransferContract(validate,'mmd-fetch/v1:page:1');
    registerResponseDecoder(validate, async response => {
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (mediaType !== 'text/html' || response.headers.get('x-mmd-page') !== '1') {
        throw new TypeError('memo-dom: expected a versioned server page HTML response');
      }
      return decodePageHtml(await response.text());
    });
  }
  const validated = {...options,validate};
  return mode ? createStreamingSource(target,validated,mode) : enableRequestEncoding(getActiveDataRuntime()).$fetch(target,validated) as unknown as ResolvedValue<PageContent>;
}
