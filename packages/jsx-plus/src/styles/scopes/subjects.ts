import {
  clone, generate, ident, parse,
  type CssNode, type ListItem, type Selector, type SelectorList,
} from 'css-tree';

function pseudoElement(node: CssNode): boolean {
  return node.type === 'PseudoElementSelector'
    || (node.type === 'PseudoClassSelector'
      && /^(?:before|after|first-line|first-letter)$/i.test(ident.decode(node.name)));
}

/** Gates add no specificity; document targets never need a component DOM marker. */
export function subjectGate(attribute: string, documents: readonly string[]): string {
  return `:where(${[`[${attribute}]`, ...documents].join(',')})`;
}

/** Origin-element selector: pseudo-elements cannot be arguments of :where(). */
function documentSelector(selector: Selector): string {
  const origin = clone(selector) as Selector;
  let afterElement = false;
  origin.children.forEach((node, item) => {
    afterElement ||= pseudoElement(node);
    if (afterElement) {
      origin.children.remove(item);
    }
  });
  return generate(origin);
}

function mark(selector: Selector, attribute: string, documents: readonly string[]): void {
  let before: ListItem<CssNode> | undefined;
  selector.children.forEach((node, item) => {
    if (node.type === 'Combinator') {
      before = undefined;
    } else if (before === undefined && pseudoElement(node)) {
      before = item;
    }
  });

  const marker = parse(subjectGate(attribute, documents), { context: 'selector' });
  if (marker.type !== 'Selector') {
    return;
  }
  for (const node of marker.children) {
    if (before === undefined) {
      selector.children.appendData(node);
    } else {
      selector.children.insertData(node, before);
    }
  }
}

/**
 * Return the explicitly selected document elements while scoping other subjects.
 * Inspect only the last compound: `body .card` still selects a local card.
 */
function scopeSubject(selector: Selector, attribute: string, inherited: readonly string[]): string[] {
  let compound: CssNode[] = [];
  for (const node of selector.children) {
    if (node.type === 'Combinator') {
      compound = [];
    } else {
      compound.push(node);
    }
  }

  const explicitDocument = compound.some((node) => {
    if (node.type === 'TypeSelector') {
      return /^(?:html|body)$/i.test(ident.decode(node.name));
    }
    return node.type === 'PseudoClassSelector' && ident.decode(node.name).toLowerCase() === 'root';
  });
  if (explicitDocument) {
    return [documentSelector(selector)];
  }

  if (inherited.length > 0 && compound.some((node) => node.type === 'NestingSelector')) {
    mark(selector, attribute, inherited);
    return [...inherited];
  }

  // In :is(body, .card), only the .card alternative needs a marker. Marking
  // the whole subject would make the explicitly requested body unreachable.
  // Negative/relational pseudos (:not/:has) do not prove a document target.
  for (const node of compound) {
    if (node.type !== 'PseudoClassSelector' || node.children === null
      || !/^(?:is|where)$/i.test(ident.decode(node.name))) {
      continue;
    }
    const candidate = clone(node) as typeof node;
    const documents: string[] = [];
    for (const child of candidate.children!) {
      if (child.type === 'SelectorList') {
        documents.push(...scopeSubjects(child, attribute, inherited));
      }
    }
    if (documents.length > 0) {
      node.children = candidate.children;
      return documents;
    }
  }

  mark(selector, attribute, []);
  return [];
}

export function scopeSubjects(prelude: SelectorList, attribute: string, inherited: readonly string[]): string[] {
  const documents = new Set<string>();
  for (const selector of prelude.children) {
    if (selector.type === 'Selector') {
      for (const document of scopeSubject(selector, attribute, inherited)) {
        documents.add(document);
      }
    }
  }
  return [...documents];
}
