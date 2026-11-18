/**
 * Testing-only runtime entry with registry introspection.
 *
 * Keeping these exports out of the production entry prevents test diagnostics
 * from becoming part of application bundles.
 */

export * from './index';
export { _internals } from './kernel';
export { createRenderPreparation } from './preparation';
export { createPreparedRegion } from './prepared-region';
export { noteRenderReadiness } from './render-readiness';
// Internal helpers runtime tests drive directly, no longer on the public entry (2026-11-18).
export { refAssign } from './refs';
export { registerEffect } from './effect';
