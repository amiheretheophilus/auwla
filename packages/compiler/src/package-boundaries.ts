import type { TransparentSourceMethod } from './context';
import type {
  ExperimentalPackageArtifact,
  ExperimentalPackageFunctionSummary,
} from './linking/model';

/** An argument itself, or a property path rooted at that argument. */
export type PackageBoundaryArgument = number | {
  readonly argument: number;
  readonly path?: readonly string[];
};

/**
 * Manual dependency facts for runtime code which package compilation cannot
 * inspect. Ordinary compiled helpers and components do not need this.
 */
export interface PackageFunctionBoundary {
  /** Arguments whose request-holder identity is inspected. */
  readonly source?: readonly PackageBoundaryArgument[];
  /** Arguments whose resolved request payload is consumed. */
  readonly payload?: readonly PackageBoundaryArgument[];
  /** Arguments or argument properties which may be written. */
  readonly writes?: readonly PackageBoundaryArgument[];
  readonly unbounded?: boolean;
  readonly transparentSourceFactory?: boolean;
  readonly transparentSourceMethod?: TransparentSourceMethod;
}

export type PackageBoundaryEntries = Readonly<Record<
  string,
  Readonly<Record<string, PackageFunctionBoundary>>
>>;

function parameterFact(
  value: PackageBoundaryArgument,
): { index: number; path: string[] } {
  const index = typeof value === 'number' ? value : value.argument;
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(
      `memo-dom: package boundary argument must be a non-negative integer; received ${String(index)}`,
    );
  }
  return {
    index,
    path: typeof value === 'number' ? [] : [...(value.path ?? [])],
  };
}

/**
 * Describe only opaque runtime boundaries. The compiler generates complete
 * artifacts automatically for package source passed to
 * `experimentalCompilePackage`.
 */
export function definePackageBoundaries(
  entries: PackageBoundaryEntries,
): ExperimentalPackageArtifact {
  const artifactEntries: ExperimentalPackageArtifact['entries'] = {};
  for (const [specifier, boundaries] of Object.entries(entries)) {
    const functions: Record<string, ExperimentalPackageFunctionSummary> = {};
    for (const [exported, boundary] of Object.entries(boundaries)) {
      functions[exported] = {
        ...(boundary.transparentSourceFactory === true
          ? { transparentSourceFactory: true }
          : {}),
        ...(boundary.transparentSourceMethod === undefined
          ? {}
          : { transparentSourceMethod: boundary.transparentSourceMethod }),
        parameterWrites: (boundary.writes ?? []).map(parameterFact),
        parameterSourceReads: (boundary.source ?? []).map(parameterFact),
        parameterPayloadReads: (boundary.payload ?? []).map(parameterFact),
        unbounded: boundary.unbounded === true,
      };
    }
    artifactEntries[specifier] = { functions };
  }
  return {
    kind: 'memoized-dom-package',
    version: 1,
    entries: artifactEntries,
  };
}
