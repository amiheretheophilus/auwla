import { createHash } from 'node:crypto';
import type {
  ExperimentalPackageArtifact,
  ExperimentalPackageComponentSummary,
  ExperimentalPackageFunctionSummary,
} from './model';

type UnknownRecord = Record<string, unknown>;

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const validatedArtifacts = new WeakMap<object, ExperimentalPackageArtifact>();
const artifactInstances = new WeakMap<object, string>();

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

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, 'expected an array of strings');
  return value.map((item, index) => string(item, `${path}[${index}]`));
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
  return {
    key: string(summary.key, `${path}.key`),
    props: stringArray(summary.props, `${path}.props`),
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
    slots: stringArray(summary.slots, `${path}.slots`),
    renderCallbacks: stringArray(summary.renderCallbacks, `${path}.renderCallbacks`),
    refProps: stringArray(summary.refProps, `${path}.refProps`),
    subtreeReads: stringArray(summary.subtreeReads, `${path}.subtreeReads`),
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
  };
  validatedArtifacts.set(artifact, validated);
  return validated;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson((value as UnknownRecord)[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Reproducible semantic identity for one validated package artifact. */
export function experimentalPackageArtifactInstance(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const cached = artifactInstances.get(value);
    if (cached !== undefined) return cached;
  }
  const artifact = validateExperimentalPackageArtifact(value);
  const instance = createHash('sha256')
    .update(canonicalJson(artifact))
    .digest('hex')
    .slice(0, 32);
  artifactInstances.set(artifact, instance);
  if (value !== null && typeof value === 'object') {
    artifactInstances.set(value, instance);
  }
  return instance;
}
