/**
 * JSX facts shared by planning: whitespace, names, and which markup the HTML
 * parser would rebuild differently from the JSX tree.
 */
import { is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';

/** Parentheses and erased type annotations do not change the returned value. */
export function unwrap(expression: Expression): Expression {
  let current = expression;
  while (is.ParenthesizedExpression(current) || is.TSAsExpression(current)
    || is.TSSatisfiesExpression(current) || is.TSNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Elements with no closing tag in HTML. */
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

/**
 * Tags that name an SVG element. Markup returned by a component or stored as a
 * value takes the namespace of the slot that shows it, but only these tags
 * (and what they contain) can become SVG there. Any other tag stays HTML, so
 * most templates need no SVG variant.
 */
export const SVG_ELEMENTS = new Set([
  'a', 'animate', 'animateMotion', 'animateTransform', 'circle', 'clipPath', 'defs', 'desc', 'ellipse',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting',
  'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight',
  'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence', 'filter', 'foreignObject', 'g', 'image',
  'line', 'linearGradient', 'marker', 'mask', 'metadata', 'mpath', 'path', 'pattern', 'polygon', 'polyline',
  'radialGradient', 'rect', 'script', 'set', 'stop', 'style', 'svg', 'switch', 'symbol', 'text', 'textPath',
  'title', 'tspan', 'use', 'view',
]);

/** Written as DOM properties, as the reference does (`tests/reference/runtime.ts`). */
export const PROPERTIES = new Set(['value', 'checked', 'selected']);

/** Attributes the renderer handles itself, never written to the DOM. */
export const RESERVED_ATTRIBUTES = new Set(['key', 'children', 'suspend']);

export function attributeName(name: string): string {
  if (name === 'className') return 'class';
  if (name === 'htmlFor') return 'for';
  return name;
}

/** `onClick` → `click`. Any attribute starting with `on` is an event, as in the reference. */
export function eventName(name: string): string | null {
  return name.startsWith('on') ? name.slice(2).toLowerCase() : null;
}

/** A lowercase tag is a DOM element; anything else is a component. */
export function intrinsicTag(element: Extract<Node, { type: 'JSXElement' }>): string | null {
  const name = element.openingElement.name;
  if (!is.JSXIdentifier(name)) return null;
  return /^[a-z]/.test(name.name) ? name.name : null;
}

/**
 * JSX text as React and Babel read it: lines are trimmed, lines with only
 * whitespace are dropped, and the remaining lines are joined with one space.
 */
export function cleanJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let index = 0; index < lines.length; index++) {
    if (/[^ \t]/.test(lines[index]!)) lastNonEmpty = index;
  }

  let text = '';
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!.replace(/\t/g, ' ');
    if (index !== 0) line = line.replace(/^[ ]+/, '');
    if (index !== lines.length - 1) line = line.replace(/[ ]+$/, '');
    if (line === '') continue;
    if (index !== lastNonEmpty) line += ' ';
    text += line;
  }
  return text;
}

export function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', '&quot;');
}

// ---------------------------------------------------------------------------
// Markup the HTML parser would not build as written

/** Their content is parsed by special rules (tables, raw text, forms of select). */
const PARSER_SPECIAL = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'select', 'option', 'optgroup', 'datalist', 'textarea', 'script', 'style', 'template',
  'title', 'iframe', 'noscript', 'noembed', 'noframes', 'xmp', 'plaintext',
  'html', 'head', 'body', 'frameset', 'frame',
]);

/** Elements a `<p>` may contain without the parser closing it. */
const PHRASING = new Set([
  'a', 'abbr', 'audio', 'b', 'bdi', 'bdo', 'br', 'button', 'canvas', 'cite', 'code', 'data',
  'del', 'dfn', 'em', 'embed', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'map', 'mark',
  'meter', 'object', 'output', 'picture', 'progress', 'q', 'ruby', 's', 'samp', 'small',
  'span', 'strong', 'sub', 'sup', 'svg', 'time', 'u', 'var', 'video', 'wbr', 'math', 'slot',
]);

/** An element the parser closes when the same kind opens inside it. */
const NOT_SELF_NESTING = new Set(['a', 'form', 'button', 'li', 'dt', 'dd', 'nobr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Only proven ordinary HTML elements use parsing as a creation shortcut.
// Everything else is still accepted and uses native DOM creation. In particular,
// foreign-content parsing can change both nesting and namespaces.
const TEMPLATE_ELEMENTS = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'button',
  'cite', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'i', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'main', 'mark', 'nav',
  'ol', 'p', 'q', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'sup',
  'time', 'u', 'ul', 'var', 'wbr',
]);

/**
 * Whether a tree of intrinsic tags, parsed as HTML, gives back exactly that
 * tree. When not, the template is built with `createElement` instead.
 */
export function parsesAsWritten(tag: string, ancestors: readonly string[]): boolean {
  if (PARSER_SPECIAL.has(tag)) return false;
  if (!TEMPLATE_ELEMENTS.has(tag)) return false;
  if (ancestors.includes('svg') || ancestors.includes('math')) return false;
  if (ancestors.includes('p') && !PHRASING.has(tag)) return false;
  if (NOT_SELF_NESTING.has(tag)) {
    const sameKind = HEADINGS.has(tag)
      ? ancestors.some((ancestor) => HEADINGS.has(ancestor))
      : ancestors.includes(tag);
    if (sameKind) return false;
  }
  return true;
}
