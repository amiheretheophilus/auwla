/**
 * State in closures, in the test reference (`wiki/compiler/output.md`, "State
 * lives anywhere"). A binding declared in a helper or factory and read by a
 * function it creates is state of that invocation:
 *
 *     function makeCounter() {
 *       let n = 1;
 *       return { read: () => n, inc: () => { n++; } };
 *     }
 *
 * Each call of `makeCounter` has its own `n`, so each gets its own dependency
 * cell, declared next to the binding:
 *
 *     let n = 1;
 *     var $closure0 = $closureCell(() => n);
 *     return { read: () => $closureRead($closure0, () => n), … };
 *
 * A read inside the created function records the cell in the computation that is
 * running, as `$captureRead` does for module bindings. A computation that calls
 * `read()` through any path, known or not, then follows `n`. Writes stay native:
 * the reference compares inputs after every event.
 *
 * Component bindings have slots of their own and module bindings use
 * `$captureRead`, so neither is handled here. `prepareModuleReads` rewrites the
 * reads (`wrap`); the cells are declared afterwards (`declare`).
 */
import { BindingFlags, type Binding, type Module, type Reference } from 'yuku-analyzer';
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import { identifier, runtimeCall, thunk } from './ast';
import { enclosingFunction } from './reads';

interface CapturedBinding {
  binding: Binding;
  cell: string;
  /** The block that receives the cell declaration, and the statement it follows (null: first). */
  block: Extract<Node, { type: 'BlockStatement' }>;
  after: Statement | null;
}

export class ClosureCells {
  private readonly captured: CapturedBinding[] = [];
  private readonly cellOfRead = new Map<Reference, string>();

  /** Planned on the authored module, before any rewrite moves its statements. */
  constructor(module: Module, components: ReadonlySet<Node>) {
    for (const binding of module.bindings) {
      const place = declarationPlace(module, binding);
      if (place === undefined || components.has(place.owner)) continue;

      // Only reads from a function created inside the owner outlive its invocation.
      const reads = binding.references.filter((reference) => {
        if (reference.isWrite || reference.inTypePosition) return false;
        return enclosingFunction(module, reference.node) !== place.owner;
      });
      if (reads.length === 0) continue;

      const cell = `$closure${this.captured.length}`;
      this.captured.push({ binding, cell, block: place.block, after: place.after });
      for (const read of reads) this.cellOfRead.set(read, cell);
    }
  }

  /** `value` (the rewritten read of `reference`), recorded in its cell when it is a closure read. */
  wrap(reference: Reference, value: Expression): Expression {
    const cell = this.cellOfRead.get(reference);
    if (cell === undefined) return value;
    return runtimeCall('$closureRead', [identifier(cell), thunk(value)]);
  }

  /**
   * Declare each cell after its binding. `var`, so a closure called before the
   * declaration runs (a hoisted function, a `var` binding) sees an undefined
   * cell rather than a temporal dead zone.
   */
  declare(): void {
    for (const entry of this.captured) {
      const body = entry.block.body;
      const at = entry.after === null ? 0 : body.indexOf(entry.after) + 1;
      if (entry.after !== null && at === 0) {
        throw new Error(`reference: the declaration of ${entry.binding.name} was moved before its closure cell was declared`);
      }
      const declaration = b.VariableDeclaration({
        kind: 'var',
        declarations: [b.VariableDeclarator({
          id: b.Identifier({ name: entry.cell }),
          init: runtimeCall('$closureCell', [thunk(identifier(entry.binding.name))]),
        })],
      });
      body.splice(at, 0, declaration as Statement);
    }
  }
}

/**
 * The function that owns a binding and where its cell goes: after a variable's
 * statement, or first in a function for a parameter. Undefined for module
 * bindings, function and class names, loop heads and expression-bodied arrows.
 */
function declarationPlace(module: Module, binding: Binding) {
  if (is.Program(binding.scope.node)) return undefined;
  const name = binding.declarations[0];
  if (name === undefined) return undefined;

  if (binding.has(BindingFlags.Parameter)) {
    const fn = binding.scope.node;
    if (!is.Function(fn) || !is.BlockStatement(fn.body)) return undefined;
    return { owner: fn as Node, block: fn.body, after: null };
  }

  let declarator: Node | null = module.parentOf(name);
  while (declarator !== null && !is.VariableDeclarator(declarator)) {
    if (is.Function(declarator) || is.Class(declarator) || is.Program(declarator)) return undefined;
    declarator = module.parentOf(declarator);
  }
  if (declarator === null) return undefined;
  const statement = module.parentOf(declarator);
  const block = statement && module.parentOf(statement);
  if (!is.VariableDeclaration(statement) || !is.BlockStatement(block)) return undefined;

  const owner = enclosingFunction(module, statement);
  if (owner === undefined) return undefined;
  return { owner, block, after: statement as Statement };
}
