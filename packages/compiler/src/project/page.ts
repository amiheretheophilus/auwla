/**
 * The build-time page (`wiki/compiler/project.md`, "Build-time page"; `delivery.md`): a page that
 * cannot change ships as HTML with no JavaScript. The compiler runs the app while building
 * (`initialRender`); this writes the result into the page's HTML, for any tool: Vite's
 * `transformIndexHtml`, the Bun plugin's HTML loader, the command line.
 *
 * Only an unambiguous shell is rewritten: one module script, which loads the app's mount module,
 * and an empty `<div>` with the mount's id directly in `<body>`. Anything else is left to the
 * browser program (`null`). The rest of the file is kept byte for byte. The script's place takes a
 * `<link>` for each stylesheet the program imports, which the script would have brought, so the
 * tool still processes them.
 */
import { posix } from 'node:path';
import { importCandidates } from '../core/resolve/imports';
import type { CompiledProject } from './project';

interface Tag {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly start: number;
  readonly end: number;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

/** A tag and its closing tag. */
interface Element {
  readonly opening: Tag;
  readonly closing: Tag;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TAGS = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'xmp', 'noembed', 'noframes']);

/**
 * `shell` with the build-time page written in, or null when the page needs its browser program
 * or the shell is not one this can rewrite safely. `shellPath` is the shell's project path
 * (`./index.html`), which its script's `src` is relative to.
 */
export function initialPage(shell: string, shellPath: string, build: CompiledProject): string | null {
  const render = build.initialRender;
  if (render.kind !== 'html') return null;

  const tokens = tags(shell);
  if (tokens === null) return null;
  // Another script may write state this page reads; nothing proves it does not.
  if (tokens.filter((tag) => tag.name === 'script' && !tag.closing).length !== 1) return null;
  if (tokens.some((tag) => tag.name === 'base' || tag.name === 'template' || tag.name === 'noscript')) return null;

  const elements = matched(tokens);
  if (elements === null) return null;
  const hosts = elements.filter(({ opening }, index) => {
    return opening.name === 'div' && opening.attributes.get('id') === render.target && parentOf(elements, index)?.opening.name === 'body';
  });
  const scripts = elements.filter(({ opening }) => {
    return opening.name === 'script' && opening.attributes.get('type') === 'module'
      && scriptPath(opening.attributes.get('src'), shellPath) === render.mountModuleId;
  });
  const targets = tokens.filter((tag) => !tag.closing && tag.attributes.get('id') === render.target);
  if (hosts.length !== 1 || scripts.length !== 1 || targets.length !== 1) return null;
  if (tokens.filter((tag) => tag.name === 'body' && !tag.closing).length !== 1) return null;

  const host = hosts[0]!;
  const script = scripts[0]!;
  if (shell.slice(host.opening.end, host.closing.start).trim() !== '') return null;
  if (shell.slice(script.opening.end, script.closing.start).trim() !== '') return null;

  // A stylesheet outside the project has no URL the page could use.
  if (build.stylesheets.some((path) => !path.startsWith('./'))) return null;
  // Relative to the page, which every tool and the browser read the same way (Bun reads `/src/…`
  // from its working directory, not the project).
  const hrefs = build.stylesheets.map((path) => hrefFrom(shellPath, path));
  const links = hrefs.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`).join('\n');

  // Later edits first, so earlier offsets stay right.
  const edits = [
    { start: host.opening.end, end: host.closing.start, text: render.html },
    { start: script.opening.start, end: script.closing.end, text: links },
  ].sort((left, right) => right.start - left.start);
  let html = shell;
  for (const edit of edits) html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}

/** The project path a script's `src` loads, or null for one that is not a plain local file. */
function scriptPath(src: string | undefined, shellPath: string): string | null {
  if (src === undefined || src === '' || /[?#&]/.test(src) || /^[a-z]+:/i.test(src) || src.startsWith('//')) return null;
  if (src.startsWith('/')) return `.${src}`;
  return importCandidates(src.startsWith('.') ? src : `./${src}`, shellPath)?.[0] ?? null;
}

/** The URL of the project path `to` from the page at project path `page`: `./src/app.css`. */
function hrefFrom(page: string, to: string): string {
  const relative = posix.relative(posix.dirname(page), to);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Pairs each opening tag with its closing tag, or null when the shell does not nest cleanly. */
function matched(tokens: readonly Tag[]): (Element & { readonly depth: number })[] | null {
  const elements: (Element & { readonly depth: number })[] = [];
  const stack: Tag[] = [];
  for (const token of tokens) {
    if (token.closing) {
      const opening = stack.pop();
      if (opening === undefined || opening.name !== token.name) return null;
      elements.push({ opening, closing: token, depth: stack.length });
      continue;
    }
    // HTML ignores `/>` on an element that is not void; do not assume XML.
    if (token.selfClosing && !VOID_TAGS.has(token.name)) return null;
    if (!VOID_TAGS.has(token.name)) stack.push(token);
  }
  return stack.length === 0 ? elements : null;
}

/** The element directly containing `elements[index]`. */
function parentOf(elements: readonly (Element & { readonly depth: number })[], index: number): Element | undefined {
  const child = elements[index]!;
  return elements.find((candidate) => {
    return candidate.depth === child.depth - 1
      && candidate.opening.start < child.opening.start && candidate.closing.end > child.closing.end;
  });
}

/** Reads the shell's tags without serializing it, or null for markup this does not understand. */
function tags(html: string): Tag[] | null {
  const result: Tag[] = [];
  let offset = 0;
  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end === -1) return null;
      offset = end + 3;
      continue;
    }
    if (/^<!doctype\s/i.test(html.slice(start))) {
      const end = html.indexOf('>', start);
      if (end === -1) return null;
      offset = end + 1;
      continue;
    }
    const opening = /^<(\/)?([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(html.slice(start));
    if (opening === null) return null;
    const name = opening[2]!.toLowerCase();
    const closing = opening[1] !== undefined;
    const attributes = new Map<string, string>();
    offset = start + opening[0].length;
    let selfClosing = false;
    while (offset < html.length) {
      const whitespace = /^\s*/.exec(html.slice(offset))![0];
      offset += whitespace.length;
      if (html.startsWith('/>', offset)) {
        selfClosing = true;
        offset += 2;
        break;
      }
      if (html[offset] === '>') {
        offset++;
        break;
      }
      if (closing || whitespace === '') return null;
      const attribute = /^([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/.exec(html.slice(offset));
      if (attribute === null) return null;
      const key = attribute[1]!.toLowerCase();
      if (attributes.has(key)) return null;
      attributes.set(key, attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      offset += attribute[0].length;
    }
    if (html[offset - 1] !== '>') return null;
    result.push({ name, attributes, start, end: offset, closing, selfClosing });
    // The text of a raw element (`<script>`, `<style>`) is not markup.
    if (!closing && RAW_TAGS.has(name)) {
      const end = new RegExp(`</${name}\\s*>`, 'ig');
      end.lastIndex = offset;
      const match = end.exec(html);
      if (match === null) return null;
      result.push({ name, attributes: new Map(), start: match.index, end: end.lastIndex, closing: true, selfClosing: false });
      offset = end.lastIndex;
    }
  }
  return result;
}
