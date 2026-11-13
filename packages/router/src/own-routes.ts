/**
 * Runtimes created with routes of their own (`createRouteRuntime({ routes })` or `{ resolver }`).
 * A compiled route table is replayed onto every runtime activated after it installs
 * (`active-runtime.ts`), so each server request resolves against the application's routes; a
 * runtime given its own routes keeps them instead.
 */
const runtimesWithOwnRoutes = new WeakSet<object>();

export function noteOwnRoutes(runtime: object): void {
  runtimesWithOwnRoutes.add(runtime);
}

export function hasOwnRoutes(runtime: object): boolean {
  return runtimesWithOwnRoutes.has(runtime);
}
