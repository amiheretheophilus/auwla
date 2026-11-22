/**
 * Runtime package entry imported by compiler output.
 *
 * The compiler emits `import * as MD from '<runtimePath>'` and calls every
 * primitive through the `MD.` namespace, so this barrel must re-export the
 * full runtime surface. Ordinary browser entries additionally import mount;
 * reactive and emission primitives remain compiler-owned.
 *
 * The operations only the old compiler's output called (its access table,
 * event commits, state cells, setters, list keys, page binders and effect
 * registration) went with it on 2026-11-18, and its update model (dirty
 * reasons, volatile per-frame pulls, entity re-renders on demand) on 2026-11-22.
 */

export {
  register,
  registerEntity,
  unregister,
  unregisterSubtree,
  registeredIds,
  has,
  markDirty,
  invalidateEntity,
  undirty,
  markDirtySubtree,
  commit,
  setScheduler,
  resetScheduler,
  getEntity,
  createApplicationRuntime,
  getActiveApplicationRuntime,
  getExtensionStore,
  setActiveApplicationRuntime,
  runWithApplicationRuntime,
  getActiveEnvironment,
  runWithRenderEnvironment,
} from './kernel';
export { createStorage, type StorageShim } from './async-storage';
export type { ApplicationRuntime, Entity } from './kernel';
export type {
  Capability,
  DocumentLike,
  RenderEnvironment,
  RenderMode,
} from './environment';
export { cleanup, ownCleanup } from './cleanup';
export { readPreparationScope, releasePreparationRead } from './preparation-read';
export { createPreparedRegion } from './prepared-region';
export { isPageContent, acceptPageContent } from './page-content';
export type { PageContent } from './page-content';
export { registerPageComponent } from './page-bindings';
export { encodePageHtml, decodePageHtml, encodePageFrame, encodePageFailure, decodePageFrames } from './page-html';
export { collectRenderReadiness } from './render-readiness';
export { toPresentationError, type PresentationError, type PresentationErrorKind } from './presentation-error';
export type { CleanupDisposer } from './cleanup';
export { mountRef, assignRef, isRefNode } from './refs';
export type { RefCallback, RefValue } from './refs';
export { createEffectScope, ownedEffect, ownedCleanup, ownCleanups } from './effect-scope';
export type { EffectCallback } from './effect';

export { cloneTemplate, createTemplateCache } from './markup';
export type { TemplateCache } from './markup';
export {
  createWriteBatch, rejectConstAssignment, unchangedWrite, flushWritesBeforeAwait, resumeWritesAfterAwait,
  enterCallback, leaveCallback,
} from './write-batch';
export type { WriteBatch } from './write-batch';
export { createBuildScope, captureBuildScope, currentBuildFrame, isBuilding, isEffectInvocation } from './build-scope';
export {
  mutationTarget, mergeFields, deleteMutation, receiverMutationTarget, observeMutation, editArray, watchMutationRoots, checkMutationRoots,
  mutatedSince, mutationTime,
} from './mutation';
export { watchStale, type StaleCheck } from './stale';
export { headValue, serverPageHead, type ServerHeadTag } from './head';
export { createRowCache, fromRows, mapRows } from './list-map';
export { createRowList, uneditedItems, whenQuiet } from './row-list';
export { createComputation, noteOwnOutput, observeNamespace, readNamespace, trackEquals, trackRead, tracking, untracked } from './computation';
export { createSharedWrites } from './shared-writes';
export { prepareRequestModuleStates, registerWaitingModuleState, requestModuleState } from './module-state';
export type { BuildScope, BuildFrame } from './build-scope';

export {
  setTextData,
  setListener,
  setRowListener,
  setAttributeValue,
  setClassAttribute,
  textValue,
} from './setters';

export { rootNodes } from './jsx-dom';
export { HydrationMismatchError } from './hydration-error';
export { mount, mountOnce } from './mount';
export { registerRootFactory, rootFactoryStore, whileApplicationMounted } from './mount-core';
export type { ApplicationLifetime } from './mount-core';
export type {
  MountableComponent,
  MountOptions,
  MountTarget,
  MountedApplication,
  RootMountContext,
} from './mount';
export { setStyleValue } from './dom-values';
export { createCondRegion } from './cond';
export {
  createRenderValue, createKeyedRenderValue, createPresentationValue, createValueSlot, createIndexedValueSlot, renderNamespace,
  childSlot, disposeSlot, fuseText, disposeFused,
} from './render-value';
export {
  componentValue, componentSetup, createCompiledValue, createComponentValue, createPropsCell,
  defineComponent, sameProps, sameValue, valueComponent, type PropsCell,
} from './components';
export { publishVersions } from './computation';
export { noteCodeFromText, publishGlobal, trackGlobal } from './globals';
export type { CondRegion, CondEntry, CondBranchFactory } from './cond';
