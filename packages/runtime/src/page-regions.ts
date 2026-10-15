/** Target only compiler-owned ranges inside one remote page owner. */
import type { PageContent } from './page-content';

function findRange(root: Element, id: string): { open: Comment; end: Comment } | undefined {
  const walker = root.ownerDocument.createTreeWalker(root, 128);
  let open: Comment | undefined, depth = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const comment = node as Comment;
    if (!open) {
      if (/^mmd:[cgl]:/.test(comment.data) && comment.data.slice(6) === id) open = comment;
      continue;
    }
    if (/^mmd:[rcgl]:/.test(comment.data)) depth++;
    else if (comment.data === '/mmd') {
      if (depth-- === 0) return { open, end: comment };
    }
  }
}

/** Cumulative records allow consumers to skip intermediate resource deliveries. */
export function updatePageRegions(root: Element, previous: PageContent, next: PageContent): void {
  const before = previous.progress!, progress = next.progress!;
  if (progress.id !== before.id || progress.sequence <= before.sequence) throw new Error('memo-dom: stale server page progression');
  for (const region of progress.regions) {
    if (region.sequence <= before.sequence) continue;
    const range = findRange(root, region.id);
    // A later parent record may have removed/replaced this descendant.
    if (!range) continue;
    if (range.open.parentNode !== range.end.parentNode) throw new Error('memo-dom: invalid server page region range');
    const template = root.ownerDocument.createElement('template');
    template.innerHTML = region.html;
    while (range.open.nextSibling && range.open.nextSibling !== range.end) range.open.parentNode!.removeChild(range.open.nextSibling);
    range.end.parentNode!.insertBefore(template.content, range.end);
  }
  root.setAttribute('data-mmd-page-sequence', String(progress.sequence));
}
