import {
  inspectModules,
  type AnalysisRange,
  type AnalysisUnresolvedInput,
} from '@memoized-dom/compiler-next/analysis';
import { normalize } from '../normalize';
import type { Range, VerbatimMapping } from '../model';

export interface FactLocation {
  readonly normalized: AnalysisRange;
  readonly authored: Range | null;
  /** Enclosing ranges describe syntax only; they must never authorize edits. */
  readonly fidelity: 'verbatim' | 'enclosing' | 'unmapped';
}

/**
 * A node may enclose generated braces while its identifier children stay exact.
 * Preserve that distinction instead of disguising an enclosing range as an
 * editable source span. Lowered/foreign text is rejected by the caller first.
 */
function locate(
  range: AnalysisRange,
  mappings: readonly VerbatimMapping[],
): FactLocation {
  const [start, end] = range;
  const exact = mappings.find((mapping) => {
    return mapping.generated[0] <= start && end <= mapping.generated[1];
  });

  if (exact !== undefined) {
    const offset = exact.authored[0] - exact.generated[0];

    return {
      normalized: range,
      authored: [start + offset, end + offset],
      fidelity: 'verbatim',
    };
  }

  let authoredStart = Infinity;
  let authoredEnd = -Infinity;

  for (const mapping of mappings) {
    const [generatedStart, generatedEnd] = mapping.generated;
    if (generatedStart >= end || generatedEnd <= start) continue;

    const intersectionStart = Math.max(start, generatedStart);
    const intersectionEnd = Math.min(end, generatedEnd);
    const offset = mapping.authored[0] - generatedStart;

    authoredStart = Math.min(authoredStart, intersectionStart + offset);
    authoredEnd = Math.max(authoredEnd, intersectionEnd + offset);
  }

  if (authoredStart === Infinity) {
    return {
      normalized: range,
      authored: null,
      fidelity: 'unmapped',
    };
  }

  return {
    normalized: range,
    authored: [authoredStart, authoredEnd],
    fidelity: 'enclosing',
  };
}

/**
 * Explicit inspection API for flow-projection development. The ordinary mapper
 * does not call this yet: these are graph facts, not complete replay proofs.
 * Only the dedicated public compiler analysis entry is imported; no DOM emitter
 * or alternative binding/reactivity classifier is used here.
 */
export function inspectCheckingFacts(source: string, filename = './App.auwla') {
  const normalized = normalize(source, { filename });
  const path = `${filename}.tsx`;
  const module = inspectModules({ [path]: normalized.code }).modules[0]!;
  const snapshot = {
    version: 1 as const,
    filename,
    source,
    normalizedSource: normalized.code,
  };

  if (module.coordinates !== 'input-prefix' || module.inputSource !== normalized.code) {
    // Enum/namespace/require lowering can shift every later offset. Without a
    // lowering source map no authored facts are preferable to plausible lies.
    return {
      ...snapshot,
      status: 'unavailable-after-lowering' as const,
      bindings: [],
      expressions: [],
      escapingFunctions: [],
    };
  }

  function location(range: AnalysisRange): FactLocation {
    return locate(range, normalized.mappings);
  }

  function optionalLocation(range: AnalysisRange | null): FactLocation | null {
    return range === null ? null : location(range);
  }

  function unresolvedInput(input: AnalysisUnresolvedInput) {
    // A dependency expanded through a different module has no mapping in this
    // single-file snapshot. Do not interpret its offsets in the current file.
    const range: FactLocation = input.module === path
      ? location(input.range)
      : { normalized: input.range, authored: null, fidelity: 'unmapped' };

    return { ...input, range };
  }

  return {
    ...snapshot,
    status: 'mapped' as const,
    bindings: module.bindings.map((binding) => ({
      ...binding,
      declarations: binding.declarations.map(location),
      owner: optionalLocation(binding.owner),
      unresolved: binding.unresolved.map(unresolvedInput),
      references: binding.references.map((reference) => ({
        ...reference,
        range: location(reference.range),
        runner: optionalLocation(reference.runner),
      })),
      writes: binding.writes.map((write) => ({
        ...write,
        range: location(write.range),
        runner: optionalLocation(write.runner),
      })),
      computation: binding.computation === null ? null : {
        ...binding.computation,
        initializer: optionalLocation(binding.computation.initializer),
        unresolved: binding.computation.unresolved.map(unresolvedInput),
        builders: binding.computation.builders.map((builder) => ({
          ...builder,
          range: location(builder.range),
        })),
      },
    })),
    expressions: module.expressions.map((expression) => ({
      ...expression,
      range: location(expression.range),
      unresolved: expression.unresolved.map(unresolvedInput),
    })),
    escapingFunctions: module.escapingFunctions.map((fn) => ({
      ...fn,
      range: location(fn.range),
      unresolved: fn.unresolved.map(unresolvedInput),
    })),
  };
}

export type CheckingFacts = ReturnType<typeof inspectCheckingFacts>;
