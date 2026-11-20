/**
 * `<head>` in markup (`wiki/compiler/head.md`): its title, meta and link tags go into the
 * document's head while the component is on the page.
 *
 *     <main>                                     <main>
 *       <head>                                     {$headValue(<>
 *         <title>"{page.title} · Desk"</title>         <title>{page.title} · Desk</title>
 *       </head>                                    </>)}
 *     </main>                                    </main>
 *
 * `headValue` (`runtime/src/head.ts`) is a value its site shows like any other, so the tags
 * follow what they read with no special case in the rest of the compiler. Only the tags are
 * rewritten; the content stays where it was written, so its errors are reported there.
 *
 * Checked here: `<head>` takes no attributes and holds only `title`, `meta` and `link` (which also
 * catches `<head>` written for `<header>`), with one `<title>` at most.
 */
import { findAll, is } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import { applyEditsWithOrigin, UNEDITED, type Edit, type TextOrigin } from '../../core/parse/text-edits';

type JsxElement = Extract<Node, { type: 'JSXElement' }>;

const RUNTIME = '@memoized-dom/runtime';
const ALLOWED = new Set(['title', 'meta', 'link']);

/** A quick look before parsing: most modules have no `<head>`. */
export function mayHaveHead(source: string): boolean {
  return /<head[\s>/]/.test(source);
}

export function lowerHeadWithOrigin(path: string, source: string): { text: string; origin: TextOrigin } {
  if (!mayHaveHead(source)) return { text: source, origin: UNEDITED };
  const { program } = parse(source, { lang: 'tsx', sourceType: 'module' });
  const heads = findAll(program, 'JSXElement').filter(isHead);
  if (heads.length === 0) return { text: source, origin: UNEDITED };

  const error = (message: string, node: Node) => CompileError.at(message, path, source, node.start);
  const parents = parentsOf(program);
  const name = freshName(source, '$headValue');
  const edits: Edit[] = [{ start: 0, end: 0, text: `import { headValue as ${name} } from ${JSON.stringify(RUNTIME)};\n` }];

  for (const head of heads) {
    check(head, error);
    const parent = parents.get(head);
    // A JSX child is wrapped in braces; anywhere else (`return <head>…</head>`) it is an expression.
    const child = parent !== undefined && (is.JSXElement(parent) || is.JSXFragment(parent));
    const closing = head.closingElement;
    if (closing === null) {
      edits.push({ start: head.start, end: head.end, text: child ? '' : 'null' });
      continue;
    }
    edits.push({ start: head.openingElement.start, end: head.openingElement.end, text: `${child ? '{' : ''}${name}(<>` });
    edits.push({ start: closing.start, end: closing.end, text: `</>)${child ? '}' : ''}` });
  }
  return applyEditsWithOrigin(source, edits);
}

function isHead(element: JsxElement): boolean {
  const name = element.openingElement.name;
  return is.JSXIdentifier(name) && name.name === 'head';
}

function check(head: JsxElement, error: (message: string, node: Node) => CompileError): void {
  const attribute = head.openingElement.attributes[0];
  if (attribute !== undefined) throw error('<head> takes no attributes', attribute);
  let titles = 0;
  for (const child of head.children) {
    if (is.JSXText(child)) {
      if (child.value.trim() !== '') throw error('<head> holds title, meta and link tags, not text', child);
      continue;
    }
    if (!is.JSXElement(child)) continue;
    const name = child.openingElement.name;
    const tag = is.JSXIdentifier(name) ? name.name : '';
    if (!ALLOWED.has(tag)) {
      const hint = tag === '' ? '' : `; <${tag}> belongs in the page. For the page's header, write <header>`;
      throw error(`<head> holds title, meta and link tags${hint}`, child);
    }
    if (tag === 'title' && ++titles > 1) throw error('a <head> sets one <title>', child);
  }
}

/** `base`, or `base` with a number, that the module's text does not already use. */
function freshName(source: string, base: string): string {
  let name = base;
  for (let suffix = 2; source.includes(name); suffix++) name = `${base}${suffix}`;
  return name;
}

/** Every node's parent. */
function parentsOf(root: Node): Map<Node, Node> {
  const parents = new Map<Node, Node>();
  const visit = (node: Node) => {
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child !== null && typeof child === 'object' && typeof (child as Node).type === 'string') {
          parents.set(child as Node, node);
          visit(child as Node);
        }
      }
    }
  };
  visit(root);
  return parents;
}
