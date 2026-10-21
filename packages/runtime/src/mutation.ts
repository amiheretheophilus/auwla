/** Native member targets notify only after a completed store. */
export function mutationTarget(object: any, key: any, notify: () => void) {
  // Computed property names perform ToPropertyKey before evaluating the RHS.
  const property = Reflect.ownKeys({ [key]: 0 })[0]!;
  return {
    get value() { return object[property]; },
    set value(value: unknown) {
      object[property] = value;
      notify();
    },
  };
}
