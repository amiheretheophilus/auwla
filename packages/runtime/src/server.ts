/**
 * Server runtime entry. The public surface matches the client runtime while
 * request/application context propagation uses the host AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { setStorageFactory } from './async-storage';
import { installApplicationRuntimeStorage } from './application-scope';

setStorageFactory(<T>() => new AsyncLocalStorage<T>(), Symbol.for('memoized-dom:node-async-storage'));
// External compiled libraries may only read the active runtime, never enter it.
// Attach every server kernel copy before its first render read.
installApplicationRuntimeStorage();

export * from './index';
export { parseMarkup } from './markup-parse';
export type { MarkupChild, MarkupElement } from './markup-parse';
export { initialBootstrapDescriptor, readInitialBootstrap } from './initial-delivery';
export type { InitialBootstrap } from './initial-delivery';
