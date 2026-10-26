/**
 * Names for generated bindings that cannot collide with the module's own:
 * `_update`, then `_update2` if the author already uses `_update`.
 */
import type { Node, Statement } from 'yuku-parser';
import type { Module } from '../resolve';

export class Names {
  readonly #taken = new Set<string>();
  readonly #owned = new Map<Node, string>();
  /**
   * Module-level declarations made while emitting nested code (a template's
   * cache and builder); `emitDom` places them with its other hoisted statements.
   */
  readonly hoisted: Statement[] = [];

  constructor(module: Module) {
    for (const binding of module.bindings) this.#taken.add(binding.name);
    for (const reference of module.references) this.#taken.add(reference.name);
  }

  /** A fresh name based on `base`. */
  fresh(base: string): string {
    let name = base;
    for (let counter = 2; this.#taken.has(name); counter++) name = `${base}${counter}`;
    this.#taken.add(name);
    return name;
  }

  /**
   * One fresh name per authored node, the same for every emitter that asks:
   * a row list is declared by its site and passed to `map` by the mutation lowering.
   */
  of(node: Node, base: string): string {
    let name = this.#owned.get(node);
    if (name === undefined) this.#owned.set(node, name = this.fresh(base));
    return name;
  }

  reserve(name: string): void { this.#taken.add(name); }
}
