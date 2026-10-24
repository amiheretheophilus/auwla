/**
 * Returned JSX → a template and its sites (`model.ts`).
 *
 * Nodes are numbered in the order `materializeMarkup` returns them: children
 * before their parent, siblings in document order. A dynamic text child gets a
 * comment placeholder in the markup, so two neighbouring values (`{a}{b}`)
 * stay two text nodes; the HTML parser would merge two texts into one.
 */
import { findAll, is } from 'yuku-ast';
import type { Expression, Node } from 'yuku-parser';
import { CompileError } from '../diagnostics';
import {
  PROPERTIES, RESERVED_ATTRIBUTES, VOID_ELEMENTS, attributeName, cleanJsxText, escapeAttribute,
  escapeText, eventName, intrinsicTag, parsesAsWritten, unwrap,
} from './jsx';
import type { Site, StaticAttribute, Template, TemplateNode, UnplacedSite } from './model';
import { canPlanConditional, planConditional } from '../../features/conditionals/plan';
import { isComponentCall } from '../../features/components/plan';

export interface TemplateContext {
  readonly path: string;
  /** The module's source text, for error positions. */
  readonly source: string;
  /** Whether an expression reads something that can change. */
  reactive(expression: Expression): boolean;
  /** Exclude JSX already owned by a template from the later stored-value pass. */
  claimMarkup?(node: Node): void;
  /** Capture child expressions at creation instead of planning lazy DOM selectors. */
  readonly captureValues?: boolean;
}

type JsxRoot = Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>;
type JsxElement = Extract<Node, { type: 'JSXElement' }>;
type Namespace = 'html' | 'svg';

/** Children being collected: their node indices, and static text not yet numbered. */
interface ChildRun {
  indices: number[];
  text: string;
}

export function buildTemplate(root: JsxRoot, context: TemplateContext, ancestors: readonly string[] = [], namespace: Namespace = 'html'): { template: Template; sites: Site[] } {
  const builder = new TemplateBuilder(context, root);
  const roots = builder.children([root], ancestors, namespace);
  const nodes = builder.nodes;
  const markup = builder.parsable ? roots.map((index) => serialize(nodes, index)).join('') : null;
  return { template: { nodes, roots, markup }, sites: builder.sites };
}

/** Phases that compile what this slice does not (`wiki/compiler/plan.md`). */
export function unsupported(context: TemplateContext, node: Node, what: string, phase: number): never {
  const message = `compiler-next compiles ${what} from Phase ${phase} of wiki/compiler/plan.md`;
  throw CompileError.at(message, context.path, context.source, node.start);
}

export function containsJsx(node: Node): boolean {
  return findAll(node, ['JSXElement', 'JSXFragment']).length > 0;
}

class TemplateBuilder {
  readonly nodes: TemplateNode[] = [];
  readonly sites: Site[] = [];
  /** False when the HTML parser would build a different tree from the markup. */
  parsable = true;

  constructor(private readonly context: TemplateContext, private readonly root: JsxRoot) {}

  /**
   * The nodes for a list of JSX children, in document order. Neighbouring static
   * texts (also across fragments) become one node, as the HTML parser makes
   * them; a text is numbered only when the next node starts, so numbering stays
   * in creation order.
   */
  children(children: readonly Node[], ancestors: readonly string[], namespace: Namespace): number[] {
    const run: ChildRun = { indices: [], text: '' };
    this.collect(children, ancestors, namespace, run);
    this.flushText(run);
    return run.indices;
  }

  private collect(children: readonly Node[], ancestors: readonly string[], namespace: Namespace, run: ChildRun): void {
    for (const child of children) {
      if (is.JSXText(child)) {
        run.text += cleanJsxText(child.value);
      } else if (is.JSXFragment(child)) {
        this.context.claimMarkup?.(child);
        this.collect(child.children, ancestors, namespace, run);
      } else if (is.JSXExpressionContainer(child)) {
        if (is.JSXEmptyExpression(child.expression)) continue;
        const expression = unwrap(child.expression);
        if (is.JSXElement(expression) || is.JSXFragment(expression)) {
          this.collect([expression], ancestors, namespace, run);
          continue;
        }
        this.flushText(run);
        run.indices.push(this.textSite(child.expression, ancestors, namespace));
      } else if (is.JSXElement(child) && (isComponentCall(child) || this.isKeyedRow(child))) {
        // Shown through a value slot, so a new key mounts a new element.
        this.flushText(run);
        run.indices.push(this.textSite(child as Expression, ancestors, namespace));
      } else if (is.JSXElement(child)) {
        this.flushText(run);
        run.indices.push(this.element(child, ancestors, namespace));
      } else if (is.JSXSpreadChild(child)) {
        // `{...items}` shows each item as a child: a list.
        this.flushText(run);
        run.indices.push(this.textSite(child.expression, ancestors, namespace, true));
      }
    }
  }

  /**
   * A key outside a list follows React: an element whose key can change is a
   * keyed list of one row, so a changed key remounts it. A key that cannot
   * change is left out. A captured value's own root key travels with the value.
   */
  private isKeyedRow(element: JsxElement): boolean {
    const key = keyExpression(element);
    if (key === null) return false;
    if (this.context.captureValues) {
      return element !== this.root && constantAttribute(key) === undefined;
    }
    return this.context.reactive(key);
  }

  private flushText(run: ChildRun): void {
    if (run.text === '') return;
    run.indices.push(this.add({ kind: 'text', text: run.text }));
    run.text = '';
  }

  private textSite(expression: Expression, ancestors: readonly string[], namespace: Namespace, spread = false): number {
    const value = unwrap(expression);
    if (!spread && !this.context.captureValues && containsJsx(expression)
      && (is.ConditionalExpression(value) || is.LogicalExpression(value)) && canPlanConditional(expression, containsJsx)) {
      const conditional = planConditional(expression, {
        hasMarkup: containsJsx,
        template: (node) => buildTemplate(node, this.context, ancestors, namespace),
      });
      const node = this.add({ kind: 'placeholder' });
      this.sites.push({ kind: 'conditional', node, expression, namespace, reactive: this.context.reactive(expression), ...conditional });
      return node;
    }
    const node = this.add({ kind: 'placeholder' });
    this.sites.push({
      kind: 'text',
      node,
      expression,
      reactive: this.context.reactive(expression),
      primitive: !spread && alwaysPrimitive(expression),
      spread,
    });
    return node;
  }

  private element(element: JsxElement, ancestors: readonly string[], parentNamespace: Namespace): number {
    this.context.claimMarkup?.(element);
    const tag = intrinsicTag(element);
    if (tag === null) return unsupported(this.context, element, 'components', 6);
    if (!parsesAsWritten(tag, ancestors)) this.parsable = false;
    if (VOID_ELEMENTS.has(tag) && element.children.length > 0) this.parsable = false;

    const namespace: Namespace = tag === 'svg' ? 'svg' : parentNamespace;
    const childNamespace: Namespace = tag === 'foreignObject' ? 'html' : namespace;
    const attributes: StaticAttribute[] = [];
    const sites: UnplacedSite[] = [];
    const counts = new Map<string, number>();
    for (const attribute of element.openingElement.attributes) {
      if (!is.JSXAttribute(attribute)) continue;
      const name = attributeName(jsxAttributeName(attribute));
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const attribute of element.openingElement.attributes) {
      const repeated = is.JSXAttribute(attribute)
        && counts.get(attributeName(jsxAttributeName(attribute)))! > 1;
      this.attribute(attribute, attributes, sites, repeated);
    }

    // Attribute expressions run before child expressions, even though template
    // nodes are numbered children first. Keep evaluation order separate.
    const firstSite = this.sites.length;
    for (const site of sites) this.sites.push({ ...site, node: -1 } as Site);
    const children = this.children(element.children, [...ancestors, tag], childNamespace);
    const node = this.add({ kind: 'element', tag, namespace, attributes, children });
    for (let offset = 0; offset < sites.length; offset++) {
      this.sites[firstSite + offset] = { ...sites[offset]!, node } as Site;
    }
    return node;
  }

  private attribute(attribute: Node, attributes: StaticAttribute[], sites: UnplacedSite[], repeated: boolean): void {
    if (is.JSXSpreadAttribute(attribute)) unsupported(this.context, attribute, 'spread attributes', 6);
    if (!is.JSXAttribute(attribute)) return;

    const name = jsxAttributeName(attribute);
    if (RESERVED_ATTRIBUTES.has(name)) return;
    if (name === 'ref') unsupported(this.context, attribute, 'refs', 7);

    const value = attribute.value;
    const expression = attributeExpression(value);

    const event = eventName(name);
    if (event !== null) {
      sites.push({ kind: 'event', event, expression, reactive: this.context.reactive(expression) });
      return;
    }
    if (PROPERTIES.has(name)) {
      sites.push({ kind: 'property', name, expression, reactive: this.context.reactive(expression) });
      return;
    }

    const constant = constantAttribute(expression);
    // A later literal must still overwrite an earlier dynamic value. Keep all
    // occurrences at sites when the same DOM attribute is written more than once.
    if (constant !== undefined && !repeated) {
      if (constant !== null) attributes.push({ name: attributeName(name), value: constant });
      return;
    }
    sites.push({ kind: 'attribute', name: attributeName(name), expression, reactive: this.context.reactive(expression) });
  }

  private add(node: TemplateNode): number {
    this.nodes.push(node);
    return this.nodes.length - 1;
  }
}

/** The value of an element's `key` attribute, or null when it has none. */
export function keyExpression(element: JsxElement): Expression | null {
  for (const attribute of element.openingElement.attributes) {
    if (is.JSXAttribute(attribute) && jsxAttributeName(attribute) === 'key') {
      return attributeExpression(attribute.value);
    }
  }
  return null;
}

function jsxAttributeName(attribute: Extract<Node, { type: 'JSXAttribute' }>): string {
  return is.JSXNamespacedName(attribute.name)
    ? `${attribute.name.namespace.name}:${attribute.name.name.name}`
    : attribute.name.name;
}

/** `attr` (true), `attr="x"` (a string literal), or `attr={expression}`. */
function attributeExpression(value: Node | null): Expression {
  if (value === null) return { type: 'Literal', value: true, raw: 'true', start: 0, end: 0 } as Expression;
  if (is.JSXExpressionContainer(value) && !is.JSXEmptyExpression(value.expression)) return value.expression;
  return value as Expression;
}

/**
 * A literal attribute value as the reference writes it: the string, `''` for
 * `true`, and null (left out) for `false`, `null` and `undefined`. Undefined when
 * the value is not a literal.
 */
function constantAttribute(expression: Expression): string | null | undefined {
  if (!is.Literal(expression)) return undefined;
  const value = expression.value;
  if (value === null || value === false) return null;
  if (value === true) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

/**
 * Whether the expression's own syntax guarantees a primitive result. Every
 * unary, binary and update operator returns one, as do template text and
 * non-regex literals. A choice is primitive when every result it can pick is.
 */
function alwaysPrimitive(expression: Expression): boolean {
  const value = unwrap(expression);
  if (is.Literal(value)) return !('regex' in value);
  if (is.TemplateLiteral(value)) return true;
  if (is.BinaryExpression(value) || is.UnaryExpression(value) || is.UpdateExpression(value)) return true;
  if (is.LogicalExpression(value)) return alwaysPrimitive(value.left) && alwaysPrimitive(value.right);
  if (is.ConditionalExpression(value)) return alwaysPrimitive(value.consequent) && alwaysPrimitive(value.alternate);
  if (is.SequenceExpression(value)) return alwaysPrimitive(value.expressions.at(-1)!);
  return false;
}

function serialize(nodes: readonly TemplateNode[], index: number): string {
  const node = nodes[index]!;
  if (node.kind === 'text') return escapeText(node.text);
  if (node.kind === 'placeholder') return '<!---->';

  const attributes = node.attributes.map((attribute) => {
    return attribute.value === '' ? ` ${attribute.name}` : ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
  }).join('');
  if (VOID_ELEMENTS.has(node.tag)) return `<${node.tag}${attributes}>`;
  const children = node.children.map((child) => serialize(nodes, child)).join('');
  return `<${node.tag}${attributes}>${children}</${node.tag}>`;
}
