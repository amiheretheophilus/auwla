/**
 * The tags a page's `<head>` blocks show, written into the document's head before the page is sent
 * (`runtime/src/head.ts`, the compiler's `wiki/compiler/head.md`).
 *
 * Search engines and link previews read the HTML the server sends, so a page's title and meta tags
 * have to be in it. The template's own tag for a key the page sets (its `<title>`, a
 * `<meta name="description">`) is moved into a `<template data-mmd-head-original>`, which nothing
 * shows: the browser reads it back, to restore it on a page that sets no such tag.
 */
import type { ServerHeadTag } from '@memoized-dom/runtime/server';

/** `prefix` (the document up to the app's outlet) with the page's head tags in its head. */
export function withPageHead(prefix: string, tags: readonly ServerHeadTag[]): string {
  if (tags.length === 0) return prefix;
  const close = /<\/head\s*>/i.exec(prefix);
  let head = close === null ? '' : prefix.slice(0, close.index);
  const rest = close === null ? prefix : prefix.slice(close.index);

  const kept: string[] = [];
  for (const { key } of tags) {
    const pattern = key === null ? null : templateTag(key);
    const found = pattern === null ? null : pattern.exec(head);
    if (found === null) continue;
    kept.push(found[0]);
    head = head.slice(0, found.index) + head.slice(found.index + found[0].length);
  }
  const original = kept.length === 0 ? '' : `<template data-mmd-head-original>${kept.join('')}</template>`;
  const written = original + tags.map((tag) => tag.html).join('');
  // With no head in the template, the tags go just before the outlet, as route styles do.
  return close === null ? prefix + written : head + written + rest;
}

/** The template's tag for `key` (`keyOf` in `runtime/src/head.ts`). */
function templateTag(key: string): RegExp | null {
  if (key === 'title') return /<title\b[^>]*>[\s\S]*?<\/title\s*>/i;
  if (key === 'link:canonical') return /<link\b[^>]*\brel\s*=\s*(["']?)canonical\1[^>]*>/i;
  const meta = /^meta:(name|property):(.*)$/.exec(key);
  if (meta === null) return null;
  const [, attribute, value] = meta;
  // The value ends where its quote does, or before a space, `/` or `>` when it has none.
  return new RegExp(`<meta\\b[^>]*\\b${attribute}\\s*=\\s*(["']?)${escapeRegExp(value!)}\\1(?=[\\s/>])[^>]*>`, 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
