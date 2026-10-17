import { posix } from 'node:path';
import type {
  LinkedDynamicComponentCandidate,
  LinkedImport,
} from '../context';
import type {
  ComponentGraphNode,
} from '../component-linker';
import type {
  ExperimentalPackageComponentSummary,
  ExperimentalPackageEntry,
  ExperimentalPackageRenderPlan,
  LinkResolutionOptions,
  ModuleEntry,
  ModuleManifest,
  RenderUsage,
} from './model';
import { validateExperimentalPackageArtifact } from './package-artifact';

interface PackageEntryBinding {
  readonly specifier: string;
  readonly entry: ExperimentalPackageEntry;
  readonly instance?: string;
}

interface PackageIndex {
  readonly global: Map<string, ExperimentalPackageEntry>;
  readonly resolved: Map<string, PackageEntryBinding>;
}

const packageIndexes = new WeakMap<object, PackageIndex>();

function packageImportKey(importer: string, specifier: string): string {
  return `${importer}\0${specifier}`;
}

function packageIndex(options: LinkResolutionOptions): PackageIndex {
  const cached = packageIndexes.get(options);
  if (cached !== undefined) return cached;
  const global = new Map<string, ExperimentalPackageEntry>();
  for (const input of options.experimentalPackageArtifacts ?? []) {
    const artifact = validateExperimentalPackageArtifact(input);
    for (const [specifier, entry] of Object.entries(artifact.entries)) {
      if (global.has(specifier)) {
        throw new Error(
          `memo-dom: multiple experimental package artifacts describe entry '${specifier}'`,
        );
      }
      global.set(specifier, entry);
    }
  }
  const resolved = new Map<string, PackageEntryBinding>();
  for (const resolution of options.experimentalPackageImports ?? []) {
    if (!resolution.instance || !/^[A-Za-z0-9._~-]+$/.test(resolution.instance)) {
      throw new Error(
        `memo-dom: experimental package instance for '${resolution.specifier}' must be a non-empty portable identifier`,
      );
    }
    const key = packageImportKey(resolution.importer, resolution.specifier);
    if (resolved.has(key)) {
      throw new Error(
        `memo-dom: multiple experimental package instances resolve '${resolution.specifier}' from '${resolution.importer}'`,
      );
    }
    const artifact = validateExperimentalPackageArtifact(resolution.artifact);
    const entry = artifact.entries[resolution.specifier];
    if (entry === undefined) {
      throw new Error(
        `memo-dom: resolved experimental package artifact does not describe entry '${resolution.specifier}'`,
      );
    }
    resolved.set(key, {
      specifier: resolution.specifier,
      entry,
      instance: resolution.instance,
    });
  }
  const index = { global, resolved };
  packageIndexes.set(options, index);
  return index;
}

function packageEntries(
  options: LinkResolutionOptions,
): Map<string, ExperimentalPackageEntry> {
  return packageIndex(options).global;
}

function resolvedPackageEntries(
  options: LinkResolutionOptions,
): Map<string, PackageEntryBinding> {
  return packageIndex(options).resolved;
}

function packageEntry(
  options: LinkResolutionOptions,
  importer: string,
  source: string,
): PackageEntryBinding | undefined {
  const resolved = resolvedPackageEntries(options).get(
    packageImportKey(importer, source),
  );
  if (resolved !== undefined) return resolved;
  const entry = packageEntries(options).get(source);
  return entry === undefined ? undefined : { specifier: source, entry };
}

function packageComponentKey(
  binding: PackageEntryBinding,
  exported: string,
): string {
  return binding.instance === undefined
    ? `package:${binding.specifier}#${exported}`
    : `package:${binding.specifier}@${binding.instance}#${exported}`;
}

export interface ExperimentalPackageInitialComponent {
  readonly moduleId: string;
  readonly component: string;
  readonly initial: ExperimentalPackageRenderPlan;
  readonly slots: readonly string[];
}

/** Resolve one package-owned closed render plan for the initial-content pass. */
export function experimentalPackageInitialComponent(
  options: LinkResolutionOptions,
  importer: string,
  source: string,
  exported: string,
): ExperimentalPackageInitialComponent | undefined {
  const binding = packageEntry(options, importer, source);
  const component = binding?.entry.components?.[exported];
  if (binding === undefined || component?.initial === undefined) return undefined;
  validatePackageComponent(binding, exported, component);
  const key = packageComponentKey(binding, exported);
  return {
    moduleId: key.slice(0, key.lastIndexOf('#')),
    component: exported,
    initial: component.initial,
    slots: component.slots,
  };
}

function validatePackageComponent(
  binding: PackageEntryBinding,
  exported: string,
  component: ExperimentalPackageComponentSummary,
): void {
  const expectedKey = `package:${binding.specifier}#${exported}`;
  if (component.key !== expectedKey) {
    throw new Error(
      `memo-dom: experimental package component '${binding.specifier}' export '${exported}' has invalid key '${component.key}'`,
    );
  }
  if (component.listLightweight) {
    throw new Error(
      `memo-dom: experimental package component '${binding.specifier}' export '${exported}' advertises an unsupported lightweight row ABI`,
    );
  }
}

/** Add precompiled package components as leaf factories in the app graph. */
export function experimentalPackageComponentDeclarations(
  options: LinkResolutionOptions,
): ComponentGraphNode[] {
  const declarations: ComponentGraphNode[] = [];
  const keys = new Map<string, string>();
  const bindings: PackageEntryBinding[] = [
    ...[...packageEntries(options)].map(([specifier, entry]) => ({ specifier, entry })),
    ...resolvedPackageEntries(options).values(),
  ];
  for (const binding of bindings) {
    const { entry } = binding;
    for (const [exported, component] of Object.entries(entry.components ?? {})) {
      validatePackageComponent(binding, exported, component);
      const key = packageComponentKey(binding, exported);
      const shape = JSON.stringify(component);
      const existing = keys.get(key);
      if (existing !== undefined && existing !== shape) {
        throw new Error(
          `memo-dom: experimental package component key '${key}' is not unique`,
        );
      }
      if (existing !== undefined) continue;
      keys.set(key, shape);
      declarations.push({
        key,
        moduleId: key.slice(0, key.lastIndexOf('#')),
        local: exported,
        edges: [],
      });
    }
  }
  return declarations;
}

export function canonicalModuleId(raw: string): string {
  const slashed = raw.replace(/\\/g, '/');
  const normalized = posix.normalize(slashed);
  // posix.normalize removes a leading "./"; preserve it when the caller used
  // a project-relative id. Bare ids and aliases (`@/x`, `virtual:x`) must not
  // be rewritten as relative paths.
  if (slashed.startsWith('./') && !normalized.startsWith('../')) {
    return `./${normalized}`;
  }
  return normalized;
}

export function resolveModule(
  importer: string,
  specifier: string,
  entries: ReadonlyMap<string, ModuleEntry>,
  options: LinkResolutionOptions,
): ModuleEntry | undefined {
  const hostResolved = options.resolveImport?.(specifier, importer);
  let resolved = hostResolved;
  if (resolved === undefined) {
    const aliases = Object.entries(options.aliases ?? {}).sort(
      ([a], [b]) => b.length - a.length,
    );
    for (const [prefix, target] of aliases) {
      const matches = prefix.endsWith('/')
        ? specifier.startsWith(prefix)
        : specifier === prefix || specifier.startsWith(`${prefix}/`);
      if (!matches) continue;
      resolved = `${target}${specifier.slice(prefix.length)}`;
      break;
    }
  }
  if (resolved === undefined) {
    if (specifier.startsWith('.')) {
      const joined = posix.normalize(posix.join(posix.dirname(importer), specifier));
      resolved =
        importer.startsWith('./') && !joined.startsWith('../') ? `./${joined}` : joined;
    } else {
      resolved = specifier;
    }
  }
  const base = canonicalModuleId(resolved ?? specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.tsrx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.tsrx`,
  ];
  for (const candidate of candidates) {
    const found = entries.get(candidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function relativeModuleSpecifier(importer: string, target: string): string {
  if (!target.startsWith('.')) return target;
  const relative = posix.relative(posix.dirname(importer), target);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function linkedDynamicCandidates(
  importer: ModuleEntry,
  keys: readonly string[],
  manifests: Map<string, ModuleManifest>,
): LinkedDynamicComponentCandidate[] {
  return keys.map((key) => {
    for (const [moduleId, manifest] of manifests) {
      for (const [exported, candidate] of Object.entries(manifest.exports)) {
        if (candidate.type !== 'component' || candidate.key !== key) continue;
        return {
          key: candidate.key,
          source: relativeModuleSpecifier(importer.id, moduleId),
          imported: exported,
          props: [...candidate.props],
          objectProps: candidate.objectProps,
          acceptsUnknownProps: candidate.acceptsUnknownProps,
          hasWholeDefault: candidate.hasWholeDefault,
          listLightweight: candidate.listLightweight,
          ...(candidate.listResourceFree === true ? { listResourceFree: true } : {}),
          delegatedEvents: candidate.delegatedEvents,
          renderProps: [...candidate.renderProps],
          slots: [...candidate.slots],
          renderCallbacks: [...candidate.renderCallbacks],
          refProps: [...candidate.refProps],
          subtreeReads: [...candidate.subtreeReads],
        };
      }
    }
    throw new Error(
      `memo-dom: dynamic component candidate '${key}' is not exported; export the component so consuming modules can link it`,
    );
  });
}

export function linkImports(
  entry: ModuleEntry,
  manifest: ModuleManifest,
  manifests: Map<string, ModuleManifest>,
  entries: ReadonlyMap<string, ModuleEntry>,
  options: LinkResolutionOptions,
  renderUsage?: ReadonlyMap<string, RenderUsage>,
): Record<string, LinkedImport> {
  const linked: Record<string, LinkedImport> = {};
  for (const ref of manifest.imports) {
    const target = resolveModule(entry.id, ref.source, entries, options);
    if (target === undefined) {
      const packagedBinding = packageEntry(options, entry.id, ref.source);
      const packagedEntry = packagedBinding?.entry;
      if (packagedEntry !== undefined && ref.imported === '*') {
        throw new Error(
          `memo-dom: namespace import '${ref.local}' from '${ref.source}' cannot identify a reactive package export; use named imports`,
        );
      }
      const packaged = ref.imported === '*'
        ? undefined
        : packagedEntry?.functions[ref.imported];
      const packagedComponent = ref.imported === '*'
        ? undefined
        : packagedEntry?.components?.[ref.imported];
      if (packagedComponent !== undefined) {
        validatePackageComponent(packagedBinding!, ref.imported, packagedComponent);
        linked[ref.local] = {
          type: 'component',
          key: packageComponentKey(packagedBinding!, ref.imported),
          props: [...packagedComponent.props],
          objectProps: packagedComponent.objectProps,
          acceptsUnknownProps: packagedComponent.acceptsUnknownProps,
          hasWholeDefault: packagedComponent.hasWholeDefault,
          listLightweight: packagedComponent.listLightweight,
          ...(packagedComponent.listResourceFree === true
            ? { listResourceFree: true }
            : {}),
          delegatedEvents: [...packagedComponent.delegatedEvents],
          renderProps: [...packagedComponent.renderProps],
          slots: [...packagedComponent.slots],
          renderCallbacks: [...packagedComponent.renderCallbacks],
          refProps: [...packagedComponent.refProps],
          subtreeReads: [...packagedComponent.subtreeReads],
        };
        continue;
      }
      if (packaged !== undefined) {
        linked[ref.local] = {
          type: 'function',
          transparentSourceFactory: packaged.transparentSourceFactory,
          transparentSourceMethod: packaged.transparentSourceMethod,
          tagCandidates: [],
          componentCandidates: [],
          reads: [],
          writes: [],
          boundedWrites: [],
          parameterWrites: options.linkFunctionSummaries === false
            ? []
            : packaged.parameterWrites.map((effect) => ({
              index: effect.index,
              path: [...effect.path],
            })),
          parameterSourceReads: options.linkFunctionSummaries === false
            ? []
            : packaged.parameterSourceReads.map((effect) => ({
              index: effect.index,
              path: [...effect.path],
            })),
          parameterPayloadReads: options.linkFunctionSummaries === false
            ? []
            : packaged.parameterPayloadReads.map((effect) => ({
              index: effect.index,
              path: [...effect.path],
            })),
          unbounded: options.linkFunctionSummaries === false || packaged.unbounded,
        };
        continue;
      }
      // Calls through external imports are conservatively unbounded. If the
      // binding is only read as ordinary data, it remains non-reactive.
      linked[ref.local] = {
        type: 'function',
        tagCandidates: [],
        componentCandidates: [],
        reads: [],
        writes: [],
        boundedWrites: [],
        parameterWrites: [],
        parameterSourceReads: [],
        parameterPayloadReads: [],
        unbounded: true,
      };
      continue;
    }
    if (ref.imported === '*') {
      throw new Error(
        `memo-dom: namespace import '${ref.local}' from '${ref.source}' is used as a value, so its reactive exports cannot be identified; access members directly (${ref.local}.name) or use named imports`,
      );
    }
    const targetExport = manifests.get(target.id)?.exports[ref.imported];
    if (targetExport === undefined) {
      // Early fixed-point passes may not have discovered a re-export yet.
      linked[ref.local] = {
        type: 'function',
        tagCandidates: [],
        componentCandidates: [],
        reads: [],
        writes: [],
        boundedWrites: [],
        parameterWrites: [],
        parameterSourceReads: [],
        parameterPayloadReads: [],
        unbounded: true,
      };
      continue;
    }
    if (targetExport.type === 'state') {
      linked[ref.local] = {
        type: 'state',
        kind: targetExport.kind,
        key: targetExport.key,
        transparentSource: (targetExport as { transparentSource?: boolean })
          .transparentSource,
        tagCandidates: [...targetExport.tagCandidates],
        componentCandidates: linkedDynamicCandidates(
          entry,
          targetExport.componentCandidates,
          manifests,
        ),
        ...(targetExport.impliedReads === undefined ? {} : { impliedReads: [...targetExport.impliedReads] }),
      };
    } else if (targetExport.type === 'component') {
      const usage = renderUsage?.get(targetExport.key);
      const renderProps = targetExport.renderProps.filter(
        (prop) =>
          usage?.scalar.has(prop) !== true || usage.jsx.has(prop),
      );
      linked[ref.local] = {
        type: 'component',
        key: targetExport.key,
        props: [...targetExport.props],
        objectProps: targetExport.objectProps,
        acceptsUnknownProps: targetExport.acceptsUnknownProps,
        hasWholeDefault: targetExport.hasWholeDefault,
        listLightweight: targetExport.listLightweight,
        ...(targetExport.listResourceFree === true ? { listResourceFree: true } : {}),
        delegatedEvents: targetExport.delegatedEvents,
        renderProps,
        slots: [...targetExport.slots],
        renderCallbacks: [...targetExport.renderCallbacks],
        refProps: [...targetExport.refProps],
        subtreeReads: [...targetExport.subtreeReads],
      };
    } else if (targetExport.type === 'value') {
      linked[ref.local] = {
        type: 'value',
        ...(targetExport.reactiveClass === true ? { reactiveClass: true } : {}),
      };
      continue;
    } else {
      if (options.linkFunctionSummaries === false) {
        linked[ref.local] = {
          type: 'function',
          transparentSourceFactory: targetExport.transparentSourceFactory,
          transparentSourceMethod: targetExport.transparentSourceMethod,
          tagCandidates: [...targetExport.tagCandidates],
          componentCandidates: linkedDynamicCandidates(
            entry,
            targetExport.componentCandidates,
            manifests,
          ),
          reads: [],
          writes: [],
          boundedWrites: [],
          parameterWrites: [],
          parameterSourceReads: [],
          parameterPayloadReads: [],
          unbounded: true,
        };
        continue;
      }
      linked[ref.local] = {
        type: 'function',
        transparentSourceFactory: targetExport.transparentSourceFactory,
        transparentSourceMethod: targetExport.transparentSourceMethod,
        tagCandidates: [...targetExport.tagCandidates],
        componentCandidates: linkedDynamicCandidates(
          entry,
          targetExport.componentCandidates,
          manifests,
        ),
        reads: [...targetExport.reads],
        ...(targetExport.plainListReturn === undefined ? {} : { plainListReturn: targetExport.plainListReturn }),
        ...(targetExport.opaqueReads === true ? { opaqueReads: true } : {}),
        writes: [...targetExport.writes],
        boundedWrites: [...targetExport.boundedWrites],
        parameterWrites: [...targetExport.parameterWrites],
        parameterSourceReads: targetExport.parameterSourceReads.map((effect) => ({
          index: effect.index,
          path: [...effect.path],
        })),
        parameterPayloadReads: targetExport.parameterPayloadReads.map((effect) => ({
          index: effect.index,
          path: [...effect.path],
        })),
        unbounded: targetExport.unbounded,
      };
    }
  }
  return linked;
}
