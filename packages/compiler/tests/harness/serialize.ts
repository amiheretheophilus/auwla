/**
 * What the user can see, as a string that two renderers can be compared on.
 *
 * - comments are dropped (renderers may use them as markers);
 * - adjacent text nodes are merged, and empty text is dropped;
 * - attributes are sorted;
 * - form controls show their live `.value` / `.checked`, not the attribute.
 */

const FORM_PROPERTIES = new Set(['value', 'checked', 'selected']);

export function serialize(container: Node): string {
  return serializeChildren(container);
}

function serializeChildren(parent: Node): string {
  let output = '';
  let text = '';

  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? '';
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    output += escapeText(text);
    text = '';
    output += serializeElement(child as Element);
  }

  return output + escapeText(text);
}

function serializeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const attributes = [...element.attributes]
    .filter((attribute) => !FORM_PROPERTIES.has(attribute.name))
    .map((attribute) => ` ${attribute.name}="${escapeAttribute(attribute.value)}"`)
    .sort();

  if (element instanceof HTMLInputElement) {
    attributes.push(` .value="${escapeAttribute(element.value)}"`);
    if (element.type === 'checkbox' || element.type === 'radio') attributes.push(` .checked=${element.checked}`);
  } else if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    attributes.push(` .value="${escapeAttribute(element.value)}"`);
  }

  return `<${tag}${attributes.join('')}>${serializeChildren(element)}</${tag}>`;
}

function escapeText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;');
}
