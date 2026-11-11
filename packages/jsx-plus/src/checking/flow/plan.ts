import { inspectModules, CompileError } from '@memoized-dom/compiler-next/analysis';
import type {
  AnalysisBinding,
  AnalysisModule,
  AnalysisRange,
} from '@memoized-dom/compiler-next/analysis';
import { parseModule } from '../../host';
import type { NormalizedSource, Range } from '../../model';
import { authoredCover } from '../../source';
import { indexSyntax } from './syntax';

export interface Insertion {
  readonly offset: number;
  readonly text: string;
  readonly order: number;
}

export interface FlowRegion {
  readonly normalized: Range;
  readonly authored: Range;
}

export interface FlowPlan {
  readonly insertions: Insertion[];
  readonly regions: FlowRegion[];
}

function authoredRegion(normalized: NormalizedSource, range: AnalysisRange): FlowRegion | null {
  const authored = authoredCover(normalized.mappings, range);
  return authored === null ? null : { normalized: range, authored };
}

/**
 * A secondary view widens typed state seeds and exposes possible prop writes.
 * Only compiler-described dependent regions use that view's diagnostics. The
 * original view retains normal host narrowing and all editor symbol operations.
 */
export function planFlow(normalized: NormalizedSource, filename: string): FlowPlan | null {
  const source = normalized.code;
  const path = `${filename}.tsx`;
  let module: AnalysisModule;

  try {
    module = inspectModules({ [path]: source }).modules[0]!;
  } catch (error) {
    if (!(error instanceof CompileError)) {
      throw error;
    }
    return null;
  }

  if (module.coordinates !== 'input-prefix') {
    return null;
  }

  const program = parseModule(source).program;
  const isModule = program.body.some((node) => {
    return node.type.startsWith('Import') || node.type.startsWith('Export');
  });
  // A second script view would redeclare its globals in the checking project.
  if (!isModule) {
    return null;
  }

  const syntax = indexSyntax(program);
  const nodes = syntax.byStart;
  const insertions: Insertion[] = [];
  const changed = new Set<string>();

  function widenValue(range: Range, type: string) {
    // An explicitly instantiated identity call validates the copied argument
    // and returns its full declared type. A cast would hide incompatible inputs;
    // `satisfies` reports some failures on an unmapped generated keyword instead.
    // The authored value remains an argument in its original await/yield scope.
    insertions.push({
      offset: range[0],
      text: `(<T,>(value: T): T => value)<${type}>((`,
      order: -range[1],
    });
    insertions.push({
      offset: range[1],
      text: '))',
      order: -range[0],
    });
  }

  for (const binding of module.bindings) {
    if (!binding.componentOwned || binding.owner === null) {
      continue;
    }

    const hasCapturedAssignment = binding.writes.some((write) => {
      return write.timing === 'later' && (write.kind === 'assign' || write.kind === 'update');
    });
    // A call can make a subsequently reassigned binding Derived or Opaque.
    // Keep the captured-write evidence regardless of that classification; it
    // does not prove when the callback runs. Select dependent regions separately.
    const canWidenSeed = binding.kind === 'State'
      || (binding.kind !== 'Prop' && hasCapturedAssignment);

    if (canWidenSeed && binding.declarations.length === 1) {
      const declaration = nodes.get(binding.declarations[0]![0])?.find((node) => {
        return node.type === 'VariableDeclarator';
      });
      if (declaration?.type !== 'VariableDeclarator' || declaration.init === null) {
        continue;
      }
      if (declaration.id.type !== 'Identifier' || declaration.id.typeAnnotation == null) {
        continue;
      }

      const annotation = declaration.id.typeAnnotation.typeAnnotation;
      const type = source.slice(annotation.start, annotation.end);
      const initializer = declaration.init;

      // Group the original initializer before checking its declared type so
      // yield/await/conditional precedence keeps its original host meaning.
      widenValue([initializer.start, initializer.end], type);

      // A later initialization statement can narrow the seed again. Widen plain
      // assignments directly in the same body, where the annotation's lexical
      // type scope is unchanged. The original view still checks their validity.
      for (const write of binding.writes) {
        if (write.kind !== 'assign' || write.timing !== 'body') {
          continue;
        }
        const assignment = syntax.at(write.range);
        if (assignment?.type !== 'AssignmentExpression' || assignment.operator !== '=') {
          continue;
        }
        if (!syntax.isDirectBodyStatement(assignment, binding.owner)) {
          continue;
        }

        const value = assignment.right;
        widenValue([value.start, value.end], type);
      }
      changed.add(binding.id);
    }

    if (binding.kind === 'Prop') {
      const owner = nodes.get(binding.owner[0])?.find((node) => {
        return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression'
          || node.type === 'ArrowFunctionExpression';
      });
      if (owner === undefined || !('body' in owner) || owner.body?.type !== 'BlockStatement') {
        continue;
      }

      // This generated, uninvoked writer teaches TS that a captured prop may
      // change. It never becomes runtime output and moves no authored code.
      insertions.push({
        offset: owner.body.start + 1,
        text: `\n;void (() => { ${binding.name} = ${binding.name}; });\n`,
        order: 0,
      });
      changed.add(binding.id);
    }
  }

  if (changed.size === 0) {
    return null;
  }
  const bindings = new Map(module.bindings.map((binding) => [binding.id, binding]));

  function dependsOnChanged(dependencies: readonly string[]): boolean {
    const pending = [...dependencies];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const id = pending.pop()!;
      if (changed.has(id)) {
        return true;
      }
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);
      pending.push(...(bindings.get(id)?.dependencies ?? []));
    }

    return false;
  }

  const regions: FlowRegion[] = [];

  function include(range: AnalysisRange, dependencies: readonly string[]) {
    if (!dependsOnChanged(dependencies)) {
      return;
    }
    const region = authoredRegion(normalized, syntax.diagnosticRange(range));
    if (region !== null) {
      regions.push(region);
    }
  }

  function includeDerived(binding: AnalysisBinding) {
    if (!binding.componentOwned || binding.kind !== 'Derived' || binding.computation === null) {
      return;
    }
    const computation = binding.computation;
    if (computation.initializer !== null) {
      include(computation.initializer, computation.dependencies);
    }
    for (const builder of computation.builders) {
      include(builder.range, computation.dependencies);
    }
  }

  for (const expression of module.expressions) {
    include(expression.range, expression.dependencies);
  }

  for (const binding of module.bindings) {
    includeDerived(binding);
  }

  for (const escaping of module.escapingFunctions) {
    include(escaping.range, escaping.dependencies);
  }

  if (regions.length === 0) {
    return null;
  }
  // At a shared offset, outer prefixes and inner suffixes must be inserted first.
  insertions.sort((a, b) => a.offset - b.offset || a.order - b.order);
  return { insertions, regions };
}
