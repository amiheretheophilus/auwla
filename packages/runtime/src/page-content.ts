/** Wire values owned by a server render, not browser DOM nodes. */
export interface PageContent {
  readonly $mmd: 'page';
  readonly version: 1;
  readonly id: string;
  readonly html: string;
  readonly binding?: { readonly key: string; readonly inputs: readonly unknown[] };
}

export function isPageContent(value: unknown): value is PageContent {
  if (value === null || typeof value !== 'object') return false;
  const page = value as Partial<PageContent>;
  return page.$mmd === 'page' && page.version === 1 && typeof page.id === 'string' &&
    typeof page.html === 'string' && (page.binding === undefined ||
      (typeof page.binding === 'object' && page.binding !== null &&
        typeof page.binding.key === 'string' && Array.isArray(page.binding.inputs)));
}

export interface PageBindingHandle {
  update(inputs: readonly unknown[]): void;
  dispose(): void;
}

export type PageBinder = (root: Element, inputs: readonly unknown[]) => PageBindingHandle;
const binders = new Map<string, PageBinder>();

/** Compile artifacts only. No server-selected script URLs, eval, or source text. */
export function registerPageBinder(key: string, bind: PageBinder): void {
  binders.set(key, bind);
}

export function pageBinder(key: string): PageBinder | undefined {
  return binders.get(key);
}
