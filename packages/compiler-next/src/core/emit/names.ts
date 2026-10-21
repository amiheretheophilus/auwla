/**
 * Names for generated bindings that cannot collide with the module's own:
 * `_update`, then `_update2` if the author already uses `_update`.
 */
import type { Module } from '../resolve';

export class Names {
  readonly #taken = new Set<string>();

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

  reserve(name: string): void { this.#taken.add(name); }
}
