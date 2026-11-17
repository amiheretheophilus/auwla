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
  PROPERTIES, RESERVED_ATTRIBUTES, VOID_ELEMENTS, attributeName, booleanAttributeText, cleanJsxText, escapeAttribute,
  escapeText, eventName, intrinsicTag, jsxAttributeName, parsesAsWritten, unwrap,
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
  readonly sourceReadiness?: boolean;
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
  return { template: { nodes, roots, namespace, markup }, sites: builder.sites };
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
        // `{"Hello "}` cannot change, so it is template text like JSX text, not a value written
        // at mount. `.auwla` quoted text normalizes to this form.
        const text = constantText(expression);
        if (text !== null) {
          run.text += text;
          continue;
        }
        this.flushText(run);
        run.indices.push(this.textSite(child.expression, ancestors, namespace));
      } else if (is.JSXElement(child) && (isComponentCall(child) || this.isSourceAttributeSite(child) || this.isKeyedRow(child))) {
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

  private isSourceAttributeSite(element: JsxElement): boolean {
    return this.context.sourceReadiness === true && !this.context.captureValues
      && element.openingElement.attributes.some((attribute) => {
        return is.JSXAttribute(attribute) && is.JSXExpressionContainer(attribute.value);
      });
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
      primitive: !spread && !this.context.sourceReadiness && alwaysPrimitive(expression),
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
    for (const attribute of element.openingElement.attributes) {
      this.attribute(attribute, attributes, sites, namespace);
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

  private attribute(attribute: Node, attributes: StaticAttribute[], sites: UnplacedSite[], namespace: Namespace): void {
    if (is.JSXSpreadAttribute(attribute)) unsupported(this.context, attribute, 'spread attributes', 6);
    if (!is.JSXAttribute(attribute)) return;

    const name = jsxAttributeName(attribute);
    if (name === 'key') {
      const expression = attributeExpression(attribute.value);
      // Keys belong to the same evaluation sequence as ordinary attributes.
      // Keep even overwritten keys: their expressions may have effects or throw.
      sites.push({ kind: 'key', expression, reactive: this.context.reactive(expression) });
      return;
    }
    if (RESERVED_ATTRIBUTES.has(name)) return;
    if (name === 'ref') {
      sites.push({ kind: 'ref', expression: attributeExpression(attribute.value), reactive: false });
      return;
    }

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

    // An HTML element's attribute names are case-insensitive and serialize in lower case
    // (`tabIndex` is `tabindex`), as a browser's `setAttribute` makes them; a server's DOM keeps
    // them as given, so they are written that way. SVG names keep their case (`viewBox`).
    const written = namespace === 'html' ? attributeName(name).toLowerCase() : attributeName(name);
    const constant = constantAttribute(expression, written, namespace);
    // An element writing one attribute twice takes the ordered path (`isComponentCall`).
    if (constant !== undefined) {
      const isClass = written === 'class';
      // A class written by a site is trimmed (`classValue`), so a literal one is too.
      if (constant !== null) attributes.push({ name: written, value: isClass ? constant.trim() : constant });
      return;
    }
    sites.push({ kind: 'attribute', name: written, expression, reactive: this.context.reactive(expression) });
  }

  private add(node: TemplateNode): number {
    this.nodes.push(node);
    return this.nodes.length - 1;
  }
}

/** The value of an element's `key` attribute, or null when it has none. */
export function keyExpression(element: JsxElement): Expression | null {
  let key: Expression | null = null;
  for (const attribute of element.openingElement.attributes) {
    if (is.JSXAttribute(attribute) && jsxAttributeName(attribute) === 'key') {
      key = attributeExpression(attribute.value);
    }
  }
  return key;
}

/** `attr` (true), `attr="x"` (a string literal), or `attr={expression}`. */
function attributeExpression(value: Node | null): Expression {
  if (value === null) return { type: 'Literal', value: true, raw: 'true', start: 0, end: 0 } as Expression;
  if (is.JSXExpressionContainer(value) && !is.JSXEmptyExpression(value.expression)) return value.expression;
  return value as Expression;
}

/**
 * A literal attribute value as the runtime would write it: the string, null (left out) for `null`,
 * and a boolean by the setters' rule (`booleanAttributeText`): `<main data-probe>` is
 * `data-probe="true"`, `<input disabled>` is `disabled=""`, `aria-hidden={false}` is `"false"`.
 * Undefined when the value is not a literal.
 */
function constantAttribute(expression: Expression, name = '', namespace: Namespace = 'html'): string | null | undefined {
  if (!is.Literal(expression)) return undefined;
  const value = expression.value;
  if (value === null) return null;
  if (typeof value === 'boolean') return booleanAttributeText(name, value, namespace);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return undefined;
}

/**
 * The text a host element's child shows when the source fixes it: a string or number literal, or
 * a template literal with no substitution. The text is written as it is, whitespace included,
 * because only JSX text is trimmed. Null for anything else, including `true`, `null` and regular
 * expressions, which keep their text site.
 */
function constantText(expression: Expression): string | null {
  if (is.Literal(expression)) {
    const value = expression.value;
    if (typeof value === 'string') {
      return value;
    }
    // The runtime writes a number with String(), as this does.
    if (typeof value === 'number' && !('regex' in expression)) {
      return String(value);
    }
    return null;
  }
  if (is.TemplateLiteral(expression) && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/**
 * Whether the expression's own syntax guarantees a primitive result. Every
 * unary, binary and update operator returns one, as do template text and
 * non-regex literals. A choice is primitive when every result it can pick is.
 * An optional caller proof can establish identifiers; general planning supplies
 * none, while optimize/primitive-values.ts checks initialization and all writes.
 */
export function alwaysPrimitive(
  expression: Expression,
  identifier?: (node: Extract<Node, { type: 'Identifier' }>) => boolean,
): boolean {
  const value = unwrap(expression);
  if (is.Identifier(value)) return identifier?.(value) ?? false;
  if (is.Literal(value)) return !('regex' in value);
  if (is.TemplateLiteral(value)) return true;
  if (is.BinaryExpression(value) || is.UnaryExpression(value) || is.UpdateExpression(value)) return true;
  if (is.LogicalExpression(value)) return alwaysPrimitive(value.left, identifier) && alwaysPrimitive(value.right, identifier);
  if (is.ConditionalExpression(value)) return alwaysPrimitive(value.consequent, identifier) && alwaysPrimitive(value.alternate, identifier);
  if (is.SequenceExpression(value)) return alwaysPrimitive(value.expressions.at(-1)!, identifier);
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
