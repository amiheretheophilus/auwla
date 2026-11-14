import { importResolver } from '../resolve/imports';
import type { SourceAssetResolver } from '../parse/languages';
import type { CompileModulesOptions } from '../../options';

/** Use the compiler's normal resolver without treating asset sources as JS modules. */
export function stylesheetResolver(
  modules: Readonly<Record<string, string>>,
  options: CompileModulesOptions,
): SourceAssetResolver {
  const sources = { ...options.assetSources, ...modules };
  const resolve = importResolver(Object.keys(sources), options);

  return (specifier, importer) => {
    const path = resolve(specifier, importer);
    if (typeof path !== 'string' || sources[path] === undefined) {
      return undefined;
    }
    return { path, text: sources[path] };
  };
}
