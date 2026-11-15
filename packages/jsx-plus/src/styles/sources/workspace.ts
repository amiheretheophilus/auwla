import { string } from 'css-tree';
import { CompletionItemKind, type CompletionList } from 'vscode-css-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { JsxPlusError } from '../../diagnostics';
import { readStyleBlocks, type StyleBlock } from '../blocks';
import { readStyleUses, styleChunks, type StyleUse, type StyleUseProblem } from '../uses';
import { createCssSession, type CssUseProblem } from '../tooling';
import { argumentText, readUseCalls, type UseArgument, type UseCall } from './arguments';
import { relativeSourceUri, sourceDirectory, type CssSourceHost } from './host';

export type { CssSourceHost, CssDirectoryEntry } from './host';
export { sourceDirectory } from './host';

type NativeSession = NonNullable<ReturnType<typeof createCssSession>>;
interface SourceSession extends Omit<NativeSession, 'complete'> {
  complete(offset: number): Promise<CompletionList | undefined>;
  isCurrent(): boolean;
}

interface Snapshot {
  readonly source: string;
  readonly uri: string;
  readonly version: number;
  readonly dependencies: Set<string>;
  ready: boolean;
  resolving: number;
  result?: Promise<SourceSession | undefined>;
}

interface SourceInfo {
  readonly source: string;
  readonly blocks: readonly StyleBlock[];
  readonly calls: readonly UseCall[];
  readonly uses: readonly StyleUse[];
}

interface Resolution {
  readonly uri?: string;
  readonly deferred: boolean;
  readonly failure?: string;
}

/** One current snapshot per open consumer, with source-only editor dependencies. */
export function createCssSourceWorkspace(host: CssSourceHost) {
  const snapshots = new Map<string, Snapshot>();

  async function prepare(entry: Snapshot): Promise<SourceSession | undefined> {
    const { source, uri, version } = entry;
    const current = () => snapshots.get(uri) === entry;
    const document = TextDocument.create(uri, 'auwla', version, source);
    const files = new Map<string, Promise<string | undefined>>([[uri, Promise.resolve(source)]]);
    const modules = new Map<string, SourceInfo>();
    const edges = new Map<string, Map<string, Resolution>>();
    const readFailures = new Map<string, string>();

    function read(path: string): Promise<string | undefined> {
      entry.dependencies.add(path);
      let pending = files.get(path);
      if (pending === undefined) {
        pending = Promise.resolve().then(() => host.readFile(path)).catch((error: unknown) => {
          readFailures.set(path, error instanceof Error ? error.message : String(error));
          return undefined;
        });
        files.set(path, pending);
      }
      return pending;
    }

    async function resolve(specifier: string, importer: string): Promise<Resolution> {
      let targets = edges.get(importer);
      if (targets === undefined) {
        targets = new Map();
        edges.set(importer, targets);
      }
      const known = targets.get(specifier);
      if (known !== undefined) {
        return known;
      }
      entry.resolving++;
      let result: Resolution;
      try {
        const path = await host.resolve?.(specifier, importer) ?? relativeSourceUri(specifier, importer);
        result = { uri: path, deferred: path === undefined };
      } catch (error) {
        result = { deferred: false, failure: error instanceof Error ? error.message : String(error) };
      }
      entry.resolving--;
      if (result.uri !== undefined) {
        entry.dependencies.add(result.uri);
      }
      targets.set(specifier, result);
      return result;
    }

    async function load(path: string): Promise<SourceInfo | undefined> {
      const known = modules.get(path);
      if (known !== undefined) {
        return known;
      }
      const text = await read(path);
      if (text === undefined) {
        return undefined;
      }
      let blocks: readonly StyleBlock[];
      try {
        blocks = readStyleBlocks(text, path, true).blocks;
      } catch (error) {
        if (!(error instanceof JsxPlusError)) {
          throw error;
        }
        // The production use validator reports this authored source error below.
        blocks = [];
      }
      const info: SourceInfo = {
        source: text, blocks,
        calls: blocks.flatMap((block) => readUseCalls(text.slice(block.bodyStart, block.bodyEnd), block.bodyStart)),
        uses: blocks.flatMap((block) => readStyleUses(text.slice(block.bodyStart, block.bodyEnd)).uses
          .map((use) => ({ ...use, start: block.bodyStart + use.start, end: block.bodyStart + use.end }))),
      };
      modules.set(path, info);
      return info;
    }

    const pending = [uri];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (visited.has(path)) {
        continue;
      }
      visited.add(path);
      const info = await load(path);
      for (const use of info?.uses ?? []) {
        const target = await resolve(use.path, path);
        if (target.uri !== undefined) {
          pending.push(target.uri);
        }
      }
    }

    const root = modules.get(uri);
    if (root === undefined) {
      return undefined;
    }

    const useProblems: CssUseProblem[] = [];
    function report(problem: StyleUseProblem): void {
      const call = modules.get(problem.filename)?.calls.find((item) => item.start === problem.start);
      const argument = problem.message.startsWith('No named style') ? call?.id
        : problem.message.startsWith('Cross-file @use cannot resolve') ? call?.path : undefined;
      const start = argument?.start ?? problem.start;
      const end = argument?.end ?? problem.end;
      const target = call?.path === undefined ? undefined : edges.get(problem.filename)?.get(call.path.value);
      const failure = target?.failure ?? (target?.uri === undefined ? undefined : readFailures.get(target.uri));
      const message = failure === undefined ? problem.message : `${problem.message}: ${failure}`;
      if (problem.filename === uri) {
        useProblems.push({ message, start, end });
        return;
      }

      const foreign = TextDocument.create(problem.filename, 'auwla', 0, problem.source);
      const origin = problem.consumer;
      if (origin !== undefined) {
        useProblems.push({
          message: `Imported style: ${message}`, start: origin.start, end: origin.end,
          relatedInformation: [{
            message,
            location: { uri: problem.filename, range: { start: foreign.positionAt(start), end: foreign.positionAt(end) } },
          }],
        });
      }
    }

    styleChunks(source, uri, root.blocks, () => {}, {
      checking: true,
      onProblem: report,
      deferExternal: (specifier, importer) => edges.get(importer)?.get(specifier)?.deferred ?? true,
      resolve(specifier, importer) {
        const path = edges.get(importer)?.get(specifier)?.uri;
        const found = path === undefined ? undefined : modules.get(path);
        return found === undefined || path === undefined ? undefined : { path, text: found.source };
      },
    });
    const unique = [...new Map(useProblems.map((problem) => [JSON.stringify(problem), problem])).values()];
    const native = createCssSession(source, uri, version, { useProblems: unique });
    if (native === undefined) {
      return undefined;
    }

    function completion(argument: UseArgument, offset: number, value: string, label: string, kind: CompletionItemKind) {
      const rawPrefix = source.slice(argument.start, offset);
      const decodedPrefix = string.decode(argument.quote + rawPrefix);
      return {
        label, kind, filterText: rawPrefix + value.slice(decodedPrefix.length),
        textEdit: {
          newText: argumentText(value, argument.quote),
          range: {
            start: document.positionAt(argument.start),
            end: document.positionAt(argument.closed ? argument.end : offset),
          },
        },
      };
    }

    async function completeUse(offset: number): Promise<CompletionList | undefined> {
      for (const call of root!.calls) {
        const argument = [call.path, call.id].find((item) => item !== undefined && item.start <= offset && offset <= item.end);
        if (argument === undefined) {
          continue;
        }
        const prefix = string.decode(argument.quote + source.slice(argument.start, offset));
        if (argument === call.path) {
          const slash = prefix.lastIndexOf('/');
          const directory = slash < 0 ? './' : prefix.slice(0, slash + 1);
          const name = prefix.slice(slash + 1).toLowerCase();
          const target = await resolve(directory, uri);
          const directoryUri = target.uri;
          if (directoryUri === undefined) {
            return undefined;
          }
          entry.dependencies.add(directoryUri);
          const entries = await Promise.resolve().then(() => host.readDirectory(directoryUri)).catch(() => []);
          const items = entries.filter((item) => item.name.toLowerCase().startsWith(name)
            && (item.kind === 'directory' || item.name.endsWith('.auwla'))).map((item) => {
            const suffix = item.kind === 'directory' ? '/' : '';
            return completion(argument, offset, directory + item.name + suffix, item.name + suffix,
              item.kind === 'directory' ? CompletionItemKind.Folder : CompletionItemKind.File);
          });
          return { isIncomplete: false, items };
        }
        const target = await resolve(call.path!.value, uri);
        if (target.uri === undefined) {
          return undefined;
        }
        const info = await load(target.uri);
        const ids = new Set(info?.blocks.flatMap((block) => block.id === undefined ? [] : [block.id]));
        return {
          isIncomplete: false,
          items: [...ids].filter((id) => id.toLowerCase().startsWith(prefix.toLowerCase()))
            .map((id) => completion(argument, offset, id, id, CompletionItemKind.Value)),
        };
      }
      return native!.complete(offset);
    }

    return {
      ...native,
      isCurrent: current,
      async complete(offset) {
        if (!current()) {
          return undefined;
        }
        const result = await completeUse(offset);
        return current() ? result : undefined;
      },
    };
  }

  return {
    session(source: string, uri: string, version = 0): Promise<SourceSession | undefined> {
      const known = snapshots.get(uri);
      if (known?.version === version && known.source === source) {
        return known.result!;
      }
      const entry: Snapshot = { source, uri, version, dependencies: new Set([uri]), ready: false, resolving: 0 };
      snapshots.set(uri, entry);
      entry.result = prepare(entry).then((session) => {
        entry.ready = true;
        return session;
      });
      return entry.result;
    },
    invalidate(uri: string): readonly string[] {
      const directory = sourceDirectory(uri);
      const affected: string[] = [];
      for (const [root, entry] of snapshots) {
        if (!entry.ready || entry.resolving > 0 || entry.dependencies.has(uri)
          || (directory !== undefined && entry.dependencies.has(directory))) {
          snapshots.delete(root);
          affected.push(root);
        }
      }
      return affected;
    },
    close(uri: string): void {
      snapshots.delete(uri);
    },
    dependencies(): readonly string[] {
      return [...new Set([...snapshots.values()].flatMap((entry) => [...entry.dependencies]))];
    },
    clear(): void {
      snapshots.clear();
    },
  };
}
