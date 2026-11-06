/**
 * Whether an HTML parser rebuilds exactly the tree this HTML came from. Serialized DOM does not
 * always round-trip: `<p><div></div></p>` closes the paragraph, and `<table><tr>` gains a `tbody`.
 * A page that would change shape keeps its program, so authored markup never silently restructures.
 *
 * The old compiler refuses every `table`, `select`, `pre` and `svg`, whatever is in them
 * (`packages/compiler/src/dom/html-shape.ts`). This checks what each one actually contains.
 */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** The parser treats their content or their tags specially, in ways this check does not model. */
const REFUSED = new Set([
  'frameset', 'frame', 'head', 'html', 'body', 'iframe', 'image', 'isindex', 'keygen', 'listing', 'math', 'nobr',
  'noembed', 'noframes', 'noscript', 'plaintext', 'rb', 'rp', 'rt', 'rtc', 'ruby', 'template', 'xmp',
]);

/** Holds text only, up to its own closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'search', 'section', 'summary', 'table', 'ul',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** A table's parts must be where the parser would put them, or it moves or adds elements. */
const ONLY_INSIDE: Readonly<Record<string, readonly string[]>> = {
  caption: ['table'], col: ['colgroup'], colgroup: ['table'], optgroup: ['select'], option: ['select', 'optgroup', 'datalist'],
  tbody: ['table'], td: ['tr'], tfoot: ['table'], th: ['tr'], thead: ['table'], tr: ['thead', 'tbody', 'tfoot'],
};

/** Only these can be directly inside, and a text child other than whitespace moves out. */
const ONLY_CONTAINS: Readonly<Record<string, readonly string[]>> = {
  colgroup: ['col'],
  optgroup: ['option'],
  select: ['option', 'optgroup'],
  table: ['caption', 'colgroup', 'tbody', 'tfoot', 'thead'],
  tbody: ['tr'], tfoot: ['tr'], thead: ['tr'], tr: ['td', 'th'],
};

export function htmlKeepsItsShape(html: string): boolean {
  // HTML parsing normalizes a carriage return and replaces NUL.
  if (/[\r\0]/.test(html)) return false;

  const open: string[] = [];
  const tag = /<(\/?)([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let at = 0;

  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    const parent = open[open.length - 1];
    if (parent !== undefined && !textStays(html.slice(at, match.index), parent)) return false;
    at = tag.lastIndex;

    const name = match[2]!;
    if (match[1] === '/') {
      if (open.pop() !== name) return false;
      continue;
    }

    if (!tagStays(name, open)) return false;
    if (!VOID.has(name)) open.push(name);

    if (RAW_TEXT.has(name)) {
      const end = html.indexOf(`</${name}>`, tag.lastIndex);
      if (end === -1) return false;
      // Text starting with a newline loses it, inside a `textarea`.
      if (name === 'textarea' && html[tag.lastIndex] === '\n') return false;
      tag.lastIndex = end;
      at = end;
    } else if (name === 'pre' && html[tag.lastIndex] === '\n') {
      return false;
    }
  }
  return open.length === 0;
}

function textStays(text: string, parent: string): boolean {
  return !(parent in ONLY_CONTAINS) || text.trim() === '';
}

function tagStays(name: string, open: readonly string[]): boolean {
  if (REFUSED.has(name)) return false;

  const parent = open[open.length - 1];
  const inside = ONLY_INSIDE[name];
  if (inside !== undefined && (parent === undefined || !inside.includes(parent))) return false;
  const contains = parent === undefined ? undefined : ONLY_CONTAINS[parent];
  if (contains !== undefined && !contains.includes(name)) return false;

  // SVG has its own parsing, where an HTML tag would break out. Only its own elements stay.
  if (open.includes('svg') && !open.includes('foreignObject')) return !/^(div|p|span|ul|ol|li|table|h[1-6]|img|br|hr|pre|b|i|em|strong|small|code|a|section|main|article|header|footer|nav)$/.test(name) || name === 'a';

  if (CLOSES_P.has(name) && open.includes('p')) return false;
  if ((name === 'a' || name === 'button' || name === 'form') && open.includes(name)) return false;
  if (name === 'li') {
    const item = open.lastIndexOf('li');
    if (item !== -1 && !open.slice(item + 1).some((tag) => tag === 'ul' || tag === 'ol')) return false;
  }
  if ((name === 'dd' || name === 'dt') && (open.includes('dd') || open.includes('dt'))) return false;
  return !(HEADINGS.has(name) && open.some((tag) => HEADINGS.has(tag)));
}
