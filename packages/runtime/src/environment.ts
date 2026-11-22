/**
 * environment.ts - Phase 1.2 capability descriptor.
 *
 * Runtime behavior must be selected by explicit capabilities, not inferred
 * from `typeof window` probes scattered across modules. The active
 * application runtime carries one RenderEnvironment; the browser default
 * resolves lazily against ambient globals so existing imports behave
 * identically.
 *
 * Modes map to proposal phases:
 *   client-create  ordinary browser mounting (today's only path)
 *   server-dom     Phase 1.4 LinkeDOM reference rendering
 *   server-string  Phase 4 string writer
 *   hydrate        Phase 3 adoption
 */

import type { Creations } from './adoption';

export type RenderMode =
  | 'client-create'
  | 'server-dom'
  | 'server-string'
  | 'hydrate';

/**
 * Lifecycle capabilities. 'defer' is reserved for hydration (Phase 3):
 * recorded now, executed after adoption. Until then it behaves like
 * 'disabled'.
 */
export type Capability = 'run' | 'defer' | 'disabled';

/**
 * The node operations the RUNTIME itself performs (structural anchors,
 * fragments, range removal, host lookup). Compiled element creation goes
 * through the same document in server-dom mode once Phase 1.4 lands; the
 * string tier replaces it in Phase 4.
 */
export interface DocumentLike {
  readonly hidden?: boolean;
  createComment(data: string): Comment;
  createElement(tagName: string): Element;
  createElementNS(namespaceURI: string, qualifiedName: string): Element;
  createTextNode(data: string): Text;
  createDocumentFragment(): DocumentFragment;
  createRange?(): Range;
  getElementById(id: string): Element | null;
  /** Experimental compiler-proven leaf output; absent on DOM/hydration tiers. */
  readonly htmlWriter?: {
    create(write: () => string): Node;
    text(value: string): string;
    classAttribute(value: string): string;
  };
}

export interface RenderEnvironment {
  mode: RenderMode;
  /**
   * Node source for runtime-owned structure. Defaults to the ambient
   * document in client-create mode; server modes must inject one.
   */
  document: DocumentLike;
  effects: Capability;
  refs: Capability;
  /**
   * Numbers each node a creation call returns, in program order (`adoption.ts`). A server
   * writes the numbers into its HTML; a browser adopting that HTML takes node N for creation N.
   */
  creations?: Creations;
}

function ambientDocument(): DocumentLike & Document {
  if (typeof document === 'undefined') {
    throw new Error(
      '[memo-dom] no document available - server environments must inject a DocumentLike into their application runtime',
    );
  }
  return document;
}

/** Browser default: ambient document, everything runs. */
export function clientEnvironment(): RenderEnvironment {
  return {
    mode: 'client-create',
    // Resolved lazily per access so tests stubbing globals keep working.
    get document() {
      return ambientDocument();
    },
    effects: 'run',
    refs: 'run',
  };
}

/** Merge partial overrides over the client default. */
export function resolveEnvironment(
  overrides?: Partial<RenderEnvironment>,
): RenderEnvironment {
  const base = clientEnvironment();
  if (overrides === undefined) return base;
  return {
    mode: overrides.mode ?? base.mode,
    document: overrides.document ?? base.document,
    effects: overrides.effects ?? base.effects,
    refs: overrides.refs ?? base.refs,
    creations: overrides.creations,
  };
}
