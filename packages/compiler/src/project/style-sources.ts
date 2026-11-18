/** Source-only stylesheet dependencies, using the existing host and source resolver. */
import { languageOf, type SourceLanguage } from '../core/parse/languages';
import { resolveSpecifier, type CollectedModule } from './collect';
import type { ProjectHost } from './host';

export interface StyleSources {
  readonly sources: ReadonlyMap<string, string>;
  readonly imports: ReadonlyMap<string, ReadonlyMap<string, string | false>>;
}

export async function collectStyleSources(
  modules: ReadonlyMap<string, CollectedModule>,
  host: ProjectHost,
  cache: Map<string, string>,
  languages: readonly SourceLanguage[] | undefined,
  reached: Set<string>,
  provided?: Readonly<Record<string, string>>,
): Promise<StyleSources> {
  const sources = new Map<string, string>();
  const imports = new Map<string, ReadonlyMap<string, string | false>>();
  const pending = [...modules.keys()];
  const seen = new Set<string>();
  const reads = new Map<string, Promise<string | undefined>>();

  const reading: ProjectHost = {
    ...(host.resolve === undefined ? {} : { resolve: host.resolve.bind(host) }),
    readFile(path) {
      const known = modules.get(path)?.text ?? provided?.[path] ?? cache.get(path);
      if (known !== undefined) {
        return known;
      }
      let read = reads.get(path);
      if (read === undefined) {
        read = Promise.resolve(host.readFile(path));
        reads.set(path, read);
      }
      return read;
    },
  };

  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    reached.add(path);
    const text = await reading.readFile(path);
    if (text === undefined) {
      continue;
    }
    if (!modules.has(path)) {
      sources.set(path, text);
      cache.set(path, text);
    }

    const module = modules.get(path);
    const stylesheet = module !== undefined ? module.stylesheet?.code
      : languageOf(path, languages)?.toTsx(text, path).stylesheet;
    if (stylesheet === undefined || typeof stylesheet === 'string') {
      continue;
    }
    const targets = new Map<string, string | false>();
    for (const specifier of stylesheet.dependencies) {
      if (targets.has(specifier)) {
        continue;
      }
      const target = await resolveSpecifier(specifier, path, reading, languages);
      targets.set(specifier, target);
      if (target !== false) {
        pending.push(target);
      }
    }
    imports.set(path, targets);
  }

  return { sources, imports };
}
