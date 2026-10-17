import { createHash } from 'node:crypto';
import type {
  ExperimentalPackageArtifact,
  ExperimentalPackageComponentSummary,
  ExperimentalPackageFunctionSummary,
  ExperimentalPackageRenderNode,
  ExperimentalPackageRenderPlan,
  ExperimentalPackageRenderValue,
} from './model';

type UnknownRecord = Record<string, unknown>;

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const renderDirectives = new Set([
  'ref',
  'key',
  'route',
  'route-to',
  'if',
  'else-if',
  'else',
  'suspend',
  'innerHTML',
]);
const validatedArtifacts = new WeakMap<object, ExperimentalPackageArtifact>();
const artifactInstances = new WeakMap<object, string>();

// Bump when a semantic contract or generated calling convention changes.
export const PACKAGE_COMPILER_CONTRACT = 1;
export const PACKAGE_RUNTIME_ABI = 1;

function compatibility(value: unknown): NonNullable<ExperimentalPackageArtifact['compatibility']> {
  const input = record(value, 'artifact.compatibility');
  if (input.compiler !== PACKAGE_COMPILER_CONTRACT) {
    invalid('artifact.compatibility.compiler', `unsupported compiler contract ${JSON.stringify(input.compiler)}; this compiler supports ${PACKAGE_COMPILER_CONTRACT}; upgrade the compiler or rebuild the package`);
  }
  if (input.runtime === undefined) return { compiler: PACKAGE_COMPILER_CONTRACT };
  const runtime = record(input.runtime, 'artifact.compatibility.runtime');
  if (typeof runtime.specifier !== 'string' || runtime.specifier.trim() === '' || /[\u0000-\u001f\u007f]/.test(runtime.specifier)) {
    invalid('artifact.compatibility.runtime.specifier', 'expected a non-empty runtime module specifier');
  }
  if (typeof runtime.abi !== 'number' || !Number.isSafeInteger(runtime.abi) || runtime.abi < 1) {
    invalid('artifact.compatibility.runtime.abi', 'expected a positive integer ABI');
  }
  if (runtime.abi !== PACKAGE_RUNTIME_ABI) {
    invalid('artifact.compatibility.runtime.abi', `unsupported runtime ABI ${runtime.abi}; this compiler supports ${PACKAGE_RUNTIME_ABI}; upgrade the compiler or rebuild the package`);
  }
  return { compiler: PACKAGE_COMPILER_CONTRACT, runtime: { specifier: runtime.specifier, abi: runtime.abi } };
}

/** Portable package-relative output file, never an absolute or traversing path. */
export function isPackageJavaScriptPath(path: string): boolean {
  return path.length > 0 && !/[\\\u0000-\u001f\u007f:#?*]/.test(path) &&
    !path.startsWith('/') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..') &&
    /\.(?:js|mjs|cjs)$/.test(path);
}

function integrity(value: unknown): NonNullable<ExperimentalPackageArtifact['integrity']> {
  const input = record(value, 'artifact.integrity');
  if (input.algorithm !== 'sha256') invalid('artifact.integrity.algorithm', "expected 'sha256'");
  const digest = (value: unknown, path: string): string => {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(path, 'expected a lowercase SHA-256 digest');
    return value;
  };
  const rawFiles = record(input.files, 'artifact.integrity.files');
  if (Object.keys(rawFiles).length === 0 || Object.keys(rawFiles).length > 4096) {
    invalid('artifact.integrity.files', 'expected between 1 and 4096 JavaScript files');
  }
  const files: Record<string, string> = Object.create(null);
  for (const [path, hash] of Object.entries(rawFiles)) {
    if (!isPackageJavaScriptPath(path)) invalid(`artifact.integrity.files[${JSON.stringify(path)}]`, 'expected a normalized package-relative JavaScript path');
    files[path] = digest(hash, `artifact.integrity.files[${JSON.stringify(path)}]`);
  }
  return { algorithm: 'sha256', metadata: digest(input.metadata, 'artifact.integrity.metadata'),
    manifest: digest(input.manifest, 'artifact.integrity.manifest'), files };
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `memo-dom: invalid experimental package artifact at ${path}; ${expectation}`,
  );
}

function record(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'expected an object');
  }
  return value as UnknownRecord;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'expected a boolean');
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, 'expected a string');
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = string(value, path);
  if (result.length === 0) invalid(path, 'expected a non-empty string');
  return result;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, 'expected an array of strings');
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function renderValue(
  value: unknown,
  path: string,
  props: ReadonlySet<string>,
): ExperimentalPackageRenderValue {
  const input = record(value, path);
  if (input.kind === 'literal') {
    const literal = input.value;
    if (
      literal !== null &&
      typeof literal !== 'string' &&
      typeof literal !== 'number' &&
      typeof literal !== 'boolean'
    ) {
      invalid(`${path}.value`, 'expected a JSON scalar');
    }
    if (typeof literal === 'number' && !Number.isFinite(literal)) {
      invalid(`${path}.value`, 'expected a finite JSON number');
    }
    return { kind: 'literal', value: literal as string | number | boolean | null };
  }
  if (input.kind === 'prop') {
    const name = string(input.name, `${path}.name`);
    if (!props.has(name)) {
      invalid(`${path}.name`, `expected a declared component prop; received ${JSON.stringify(name)}`);
    }
    return { kind: 'prop', name };
  }
  return invalid(`${path}.kind`, "expected 'literal' or 'prop'");
}

function renderPlan(
  value: unknown,
  path: string,
  props: ReadonlySet<string>,
  slots: ReadonlySet<string>,
): ExperimentalPackageRenderPlan {
  const plan = record(value, path);
  let count = 0;
  const nodes = (
    value: unknown,
    path: string,
    depth: number,
  ): ExperimentalPackageRenderNode[] => {
    if (!Array.isArray(value)) invalid(path, 'expected an array of render nodes');
    return value.map((item, index) => node(item, `${path}[${index}]`, depth));
  };
  const node = (
    value: unknown,
    path: string,
    depth: number,
  ): ExperimentalPackageRenderNode => {
    if (depth > 64 || ++count > 4096) {
      invalid(path, 'render plan exceeds the structural limit');
    }
    const input = record(value, path);
    if (input.kind === 'text') {
      if (!Array.isArray(input.parts) || input.parts.length === 0) {
        invalid(`${path}.parts`, 'expected a non-empty array of render values');
      }
      return {
        kind: 'text',
        parts: input.parts.map((part, index) =>
          renderValue(part, `${path}.parts[${index}]`, props)),
      };
    }
    if (input.kind === 'element') {
      const tag = string(input.tag, `${path}.tag`);
      if (!/^[a-z][a-z0-9]*$/.test(tag)) {
        invalid(`${path}.tag`, 'expected a lowercase platform tag');
      }
      if (!Array.isArray(input.attributes)) {
        invalid(`${path}.attributes`, 'expected an array of attributes');
      }
      return {
        kind: 'element',
        tag,
        site: nonEmptyString(input.site, `${path}.site`),
        attributes: input.attributes.map((attribute, index) => {
          const attributePath = `${path}.attributes[${index}]`;
          const item = record(attribute, attributePath);
          const name = string(item.name, `${attributePath}.name`);
          if (
            !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) ||
            /^on/i.test(name) ||
            renderDirectives.has(name)
          ) {
            invalid(`${attributePath}.name`, 'expected a static platform attribute');
          }
          return {
            name,
            site: nonEmptyString(item.site, `${attributePath}.site`),
            value: renderValue(item.value, `${attributePath}.value`, props),
          };
        }),
        children: nodes(input.children, `${path}.children`, depth + 1),
      };
    }
    if (input.kind === 'slot') {
      const name = string(input.name, `${path}.name`);
      if (!slots.has(name)) {
        invalid(`${path}.name`, `expected a declared component slot; received ${JSON.stringify(name)}`);
      }
      return {
        kind: 'slot',
        name,
        ...(input.site === undefined ? {} : {site:nonEmptyString(input.site, `${path}.site`)}),
        fallback: nodes(input.fallback, `${path}.fallback`, depth + 1),
      };
    }
    return invalid(`${path}.kind`, "expected 'text', 'element', or 'slot'");
  };
  const root = node(plan.root, `${path}.root`, 0);
  if (root.kind !== 'element') invalid(`${path}.root`, 'expected one host element root');
  if (plan.adoption !== undefined && !['host-v1','host-slots-v1','host-events-v1','host-slots-v2'].includes(plan.adoption as string)) {
    invalid(`${path}.adoption`, "expected 'host-v1', 'host-slots-v1', 'host-events-v1', or 'host-slots-v2'");
  }
  if (plan.events !== undefined && (plan.events !== true || plan.adoption !== 'host-slots-v2')) {
    invalid(`${path}.events`, 'expected true on a host-slots-v2 plan');
  }
  if (plan.adoption === 'host-v1' && slots.size > 0) {
    invalid(`${path}.adoption`, 'host-v1 does not support component slots');
  }
  if (plan.adoption === 'host-slots-v1' || plan.adoption === 'host-events-v1' || plan.adoption === 'host-slots-v2') {
    const sites = new Set<string>();
    const hasSlot = (input:ExperimentalPackageRenderNode):boolean => input.kind === 'slot' ||
      input.kind === 'element' && input.children.some(hasSlot);
    const check = (input: ExperimentalPackageRenderNode): void => {
      if (input.kind !== 'element') return;
      const projected = input.children.filter(child => child.kind === 'slot');
      if (projected.length && plan.adoption !== 'host-slots-v2' && (input.children.length !== 1 || projected[0]!.fallback.length > 0)) {
        invalid(`${path}.adoption`, `${plan.adoption} requires dedicated slot hosts without fallbacks`);
      }
      const slot=projected[0];
      if(plan.adoption==='host-slots-v2' && slot) {
        const position=input.children.indexOf(slot);
        if(projected.length>1 || input.children[position-1]?.kind==='text' || input.children[position+1]?.kind==='text') {
          invalid(`${path}.adoption`, 'host-slots-v2 requires one slot per host with element-separated siblings');
        }
        if (!slot.site || sites.has(slot.site)) invalid(`${path}.adoption`, 'package fallbacks require distinct authored slot sites');
        if (slot.fallback.some(hasSlot)) invalid(`${path}.adoption`, 'nested fallback slots need a separate placement contract');
        sites.add(slot.site);
      }
      input.children.forEach(check);
    };
    check(root);
  }
  return { root, ...(plan.adoption === undefined ? {} : { adoption: plan.adoption as ExperimentalPackageRenderPlan['adoption'] }),
    ...(plan.events === true ? {events:true} : {}) };
}

function facts(value: unknown, path: string): { index: number; path: string[] }[] {
  if (!Array.isArray(value)) invalid(path, 'expected an array of argument facts');
  return value.map((item, offset) => {
    const factPath = `${path}[${offset}]`;
    const fact = record(item, factPath);
    if (!Number.isInteger(fact.index) || (fact.index as number) < 0) {
      invalid(`${factPath}.index`, 'expected a non-negative integer');
    }
    return {
      index: fact.index as number,
      path: stringArray(fact.path, `${factPath}.path`),
    };
  });
}

function functionSummary(
  value: unknown,
  path: string,
): ExperimentalPackageFunctionSummary {
  const summary = record(value, path);
  const method = summary.transparentSourceMethod;
  if (method !== undefined && (typeof method !== 'string' || !methods.has(method))) {
    invalid(`${path}.transparentSourceMethod`, 'expected GET, POST, PUT, PATCH, or DELETE');
  }
  const transparentSourceFactory = summary.transparentSourceFactory;
  if (transparentSourceFactory !== undefined && typeof transparentSourceFactory !== 'boolean') {
    invalid(`${path}.transparentSourceFactory`, 'expected a boolean');
  }
  return {
    ...(transparentSourceFactory === true ? { transparentSourceFactory: true } : {}),
    ...(method === undefined ? {} : {
      transparentSourceMethod: method as ExperimentalPackageFunctionSummary['transparentSourceMethod'],
    }),
    parameterWrites: facts(summary.parameterWrites, `${path}.parameterWrites`),
    parameterSourceReads: facts(
      summary.parameterSourceReads,
      `${path}.parameterSourceReads`,
    ),
    parameterPayloadReads: facts(
      summary.parameterPayloadReads,
      `${path}.parameterPayloadReads`,
    ),
    unbounded: boolean(summary.unbounded, `${path}.unbounded`),
  };
}

function componentSummary(
  value: unknown,
  path: string,
): ExperimentalPackageComponentSummary {
  const summary = record(value, path);
  const listResourceFree = summary.listResourceFree;
  if (listResourceFree !== undefined && typeof listResourceFree !== 'boolean') {
    invalid(`${path}.listResourceFree`, 'expected a boolean');
  }
  const props = stringArray(summary.props, `${path}.props`);
  const slots = stringArray(summary.slots, `${path}.slots`);
  const initial = summary.initial === undefined
    ? undefined
    : renderPlan(
        summary.initial,
        `${path}.initial`,
        new Set(props),
        new Set(slots),
      );
  return {
    key: string(summary.key, `${path}.key`),
    props,
    objectProps: boolean(summary.objectProps, `${path}.objectProps`),
    acceptsUnknownProps: boolean(
      summary.acceptsUnknownProps,
      `${path}.acceptsUnknownProps`,
    ),
    hasWholeDefault: boolean(summary.hasWholeDefault, `${path}.hasWholeDefault`),
    listLightweight: boolean(summary.listLightweight, `${path}.listLightweight`),
    ...(listResourceFree === undefined ? {} : { listResourceFree }),
    delegatedEvents: stringArray(summary.delegatedEvents, `${path}.delegatedEvents`),
    renderProps: stringArray(summary.renderProps, `${path}.renderProps`),
    slots,
    renderCallbacks: stringArray(summary.renderCallbacks, `${path}.renderCallbacks`),
    refProps: stringArray(summary.refProps, `${path}.refProps`),
    subtreeReads: stringArray(summary.subtreeReads, `${path}.subtreeReads`),
    ...(initial === undefined ? {} : { initial }),
  };
}

/** Validate untrusted JSON before it participates in application linking. */
export function validateExperimentalPackageArtifact(
  value: unknown,
): ExperimentalPackageArtifact {
  if (value !== null && typeof value === 'object') {
    const cached = validatedArtifacts.get(value);
    if (cached !== undefined) return cached;
  }
  const artifact = record(value, 'artifact');
  if (artifact.kind !== 'memoized-dom-package') {
    invalid('artifact.kind', "expected 'memoized-dom-package'");
  }
  if (artifact.version !== 1) {
    invalid('artifact.version', 'expected format version 1');
  }
  // Do not interpret a newer contract using the current entry schema.
  const declaredCompatibility = artifact.compatibility === undefined ? undefined : compatibility(artifact.compatibility);
  const rawEntries = record(artifact.entries, 'artifact.entries');
  const entries: ExperimentalPackageArtifact['entries'] = Object.create(null);
  for (const [specifier, rawEntry] of Object.entries(rawEntries)) {
    const entryPath = `artifact.entries[${JSON.stringify(specifier)}]`;
    const entry = record(rawEntry, entryPath);
    const rawFunctions = record(entry.functions, `${entryPath}.functions`);
    const functions: Record<string, ExperimentalPackageFunctionSummary> = Object.create(null);
    for (const [exported, summary] of Object.entries(rawFunctions)) {
      functions[exported] = functionSummary(
        summary,
        `${entryPath}.functions[${JSON.stringify(exported)}]`,
      );
    }
    const rawComponents = entry.components;
    let components: Record<string, ExperimentalPackageComponentSummary> | undefined;
    if (rawComponents !== undefined) {
      components = Object.create(null) as Record<string, ExperimentalPackageComponentSummary>;
      for (const [exported, summary] of Object.entries(
        record(rawComponents, `${entryPath}.components`),
      )) {
        components[exported] = componentSummary(
          summary,
          `${entryPath}.components[${JSON.stringify(exported)}]`,
        );
      }
    }
    entries[specifier] = {
      functions,
      ...(components === undefined ? {} : { components }),
    };
  }
  const validated: ExperimentalPackageArtifact = {
    kind: 'memoized-dom-package',
    version: 1,
    entries,
    ...(declaredCompatibility === undefined ? {} : { compatibility: declaredCompatibility }),
    ...(artifact.integrity === undefined ? {} : { integrity: integrity(artifact.integrity) }),
  };
  validatedArtifacts.set(artifact, validated);
  return validated;
}

function canonicalPackageJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPackageJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalPackageJson((value as UnknownRecord)[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hash semantic facts only: post-bundle bytes do not change component identity. */
export function packageMetadataHash(artifact: ExperimentalPackageArtifact): string {
  return createHash('sha256').update(canonicalPackageJson({
    kind: artifact.kind, version: artifact.version, entries: artifact.entries,
    ...(artifact.compatibility === undefined ? {} : { compatibility: artifact.compatibility }),
  })).digest('hex');
}

/** Reproducible semantic identity for one validated package artifact. */
export function experimentalPackageArtifactInstance(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const cached = artifactInstances.get(value);
    if (cached !== undefined) return cached;
  }
  const artifact = validateExperimentalPackageArtifact(value);
  const instance = packageMetadataHash(artifact).slice(0, 32);
  artifactInstances.set(artifact, instance);
  if (value !== null && typeof value === 'object') {
    artifactInstances.set(value, instance);
  }
  return instance;
}
