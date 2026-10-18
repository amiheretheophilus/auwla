/**
 * Edits to a derived copy (`const tags = [...article.tags]; tags.push(t)`).
 *
 * A handler that edits the copy records the copy's current sources. Replays
 * keep the edited copy while every source is still the same value; once one is
 * replaced (a new `article` prop), the copy is derived again from it.
 */
import { getExtensionStore } from './kernel';

const kept = (): Map<string, Map<string, readonly unknown[]>> =>
  getExtensionStore('mmd:derived-edits', () => new Map());

/** Compiler hook: `name` in entity `id` was edited while its sources were `sources`. */
export function keepDerived(id: string, name: string, sources: readonly unknown[]): void {
  const store = kept();
  let names = store.get(id);
  if (names === undefined) store.set(id, names = new Map());
  names.set(name, sources);
}

/** Compiler hook: true keeps the edited copy (skip this replay); false derives it again. */
export function takeKeptDerived(id: string, name: string, sources: readonly unknown[]): boolean {
  const names = kept().get(id);
  const edited = names?.get(name);
  if (edited === undefined) return false;
  if (edited.length === sources.length && edited.every((value, index) => Object.is(value, sources[index]))) return true;
  names!.delete(name);
  if (names!.size === 0) kept().delete(id);
  return false;
}
