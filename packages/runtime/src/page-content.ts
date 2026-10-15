/** Wire values owned by a server render, not browser DOM nodes. */
export interface PageContent {
  readonly $mmd: 'page';
  readonly version: 1;
  readonly id: string;
  readonly html: string;
  readonly styles?: readonly string[];
  readonly binding?: { readonly key: string; readonly inputs: readonly unknown[]; readonly missing?: readonly (readonly (string|number)[])[] };
  /** Request-owned progression, not a shared component/state identity. */
  readonly progress?: {
    readonly id: string;
    readonly sequence: number;
    readonly complete: boolean;
    /** Cumulative latest region changes; skipped/coalesced frames remain safe. */
    readonly regions: readonly { readonly id: string; readonly html: string; readonly sequence: number }[];
  };
}

export function isPageContent(value: unknown): value is PageContent {
  if (value === null || typeof value !== 'object') return false;
  const page = value as Partial<PageContent>;
  return page.$mmd === 'page' && page.version === 1 && typeof page.id === 'string' &&
    typeof page.html === 'string' && (page.progress === undefined || typeof page.progress === 'object' && page.progress !== null &&
      typeof page.progress.id === 'string' && page.progress.id.length > 0 && Number.isSafeInteger(page.progress.sequence) && page.progress.sequence > 0 &&
      typeof page.progress.complete === 'boolean' && Array.isArray(page.progress.regions) && page.progress.regions.every(region =>
        region !== null && typeof region === 'object' && typeof region.id === 'string' && typeof region.html === 'string' &&
        Number.isSafeInteger(region.sequence) && region.sequence > 0 && region.sequence <= page.progress!.sequence)) &&
    (page.styles === undefined || Array.isArray(page.styles) && page.styles.every(css=>typeof css === 'string')) && (page.binding === undefined ||
      (typeof page.binding === 'object' && page.binding !== null &&
        typeof page.binding.key === 'string' && Array.isArray(page.binding.inputs) &&
        (page.binding.missing === undefined || Array.isArray(page.binding.missing) && page.binding.missing.every(path=>
          Array.isArray(path) && path.length>0 && path.every(part=>typeof part==='string'||typeof part==='number'&&Number.isSafeInteger(part)&&part>=0)))));
}

/** JSON keeps an explicit sidecar for undefined, including optional positional inputs. */
export function pageBindingInputs(binding:NonNullable<PageContent['binding']>):readonly unknown[] {
  if (!binding.missing?.length) return binding.inputs;
  const inputs=structuredClone(binding.inputs);
  for (const path of binding.missing) {
    let object:unknown=inputs;
    for(let index=0;index<path.length;index++) {
      const key=path[index]!;
      if(key==='__proto__'||key==='prototype'||key==='constructor'||object===null||typeof object!=='object'||!Object.hasOwn(object,key))throw new TypeError('memo-dom: invalid page binding input path');
      if(index===path.length-1)(object as Record<string|number,unknown>)[key]=undefined;
      else object=(object as Record<string|number,unknown>)[key];
    }
  }
  return inputs;
}
const authorized = new WeakSet<object>();
/** Only generated page transports and their verified SSR restoration call this. */
export function acceptPageContent(value:unknown):PageContent {
  if (!isPageContent(value)) throw new TypeError('memo-dom: invalid server page content');
  authorized.add(value);
  return value;
}
export function isRenderablePage(value:unknown):value is PageContent {
  return typeof value === 'object' && value !== null && authorized.has(value);
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
