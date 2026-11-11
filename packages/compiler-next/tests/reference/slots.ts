/**
 * The reference's own lowering of component slots (`wiki/compiler/components.md`, "Slots"). It
 * shares no code with compiler-next's (`src/features/slots/`), so a mistake in either shows as a
 * difference in the comparison cases.
 *
 * What a slot means, as plain JavaScript:
 *
 *     function Panel() {                          function Panel({ children: $slot_default,
 *       return <section>                                           "slot:header": $slot_header }) {
 *         <slot name="header">Untitled</slot>      return <section>
 *         <slot />                                   {$slot_header !== void 0 ? $slot_header : <>Untitled</>}
 *       </section>;                                  {$slot_default}
 *     }                                            </section>;
 *                                                 }
 *     <Panel><h1 slot="header">A</h1><p>B</p></Panel>
 *                                                 <Panel slot:header={<h1>A</h1>}><p>B</p></Panel>
 *
 * - The default slot is the `children` prop; a named slot is the prop `slot:<name>`.
 * - A placeholder's own children are its fallback, shown when the slot's value is `undefined`,
 *   as a default parameter is.
 * - A direct child marked `slot="x"` goes to `slot:x`, in authored order, and loses the marker.
 *   So does a direct child expression whose JSX results are all marked `x` (`{cond && <b slot="x"/>}`).
 * - A placeholder that is a direct child of a component call forwards: its `name` reads the
 *   enclosing component's slot, its `slot` picks the inner component's.
 */
import { b, findAll, is } from 'yuku-ast';
import { generate } from 'yuku-codegen';
import { parse } from 'yuku-parser';
import type { Expression, Node } from 'yuku-parser';

type JsxElement = Extract<Node, { type: 'JSXElement' }>;
type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;
type ObjectPattern = Extract<Node, { type: 'ObjectPattern' }>;

/** The default slot's name. A named slot always has a non-empty one. */
const DEFAULT = '';

export function lowerReferenceSlots(source: string): string {
  if (!/<slot\b|\sslot=/.test(source)) return source;
  const { program } = parse(source, { lang: 'tsx', sourceType: 'module' });
  const parents = parentsOf(program);
  const lowering = new SlotLowering(source, parents);

  for (const element of findAll(program, 'JSXElement')) {
    if (isPlaceholder(element)) lowering.placeholder(element);
  }
  for (const element of findAll(program, 'JSXElement')) {
    if (isComponentCall(element)) lowering.call(element);
  }
  // A marker that is still there was not on a direct child of a component call.
  for (const attribute of findAll(program, 'JSXAttribute')) {
    if (is.JSXIdentifier(attribute.name) && attribute.name.name === 'slot') {
      throw new Error('reference: a slot marker must be on a direct child of a component');
    }
  }
  return generate(program).code;
}

class SlotLowering {
  /** Each component's expression for each slot it shows. */
  readonly #values = new Map<FunctionNode, Map<string, string>>();
  /** A lowered placeholder that forwards, and the inner slot it goes to. */
  readonly #forwarded = new Map<Node, string>();

  constructor(private readonly source: string, private readonly parents: Map<Node, Node>) {}

  /** `<slot name="x">fallback</slot>` → the slot's value, or the fallback while it is undefined. */
  placeholder(element: JsxElement): void {
    const component = this.#component(element);
    const name = staticAttribute(element, 'name', true) ?? DEFAULT;
    const value = this.#value(component, name);
    const fallback = element.children.filter((child) => !isLayoutText(child));
    const shown: Expression = fallback.length === 0
      ? parseExpression(value)
      : b.ConditionalExpression({
        test: b.BinaryExpression({ operator: '!==', left: parseExpression(value), right: parseExpression('void 0') }),
        consequent: parseExpression(value),
        alternate: fragment(element.children),
      });
    const parent = this.parents.get(element)!;
    const replacement = is.JSXElement(parent) || is.JSXFragment(parent)
      ? b.JSXExpressionContainer({ expression: shown }) as Node
      : shown as Node;
    const target = staticAttribute(element, 'slot', true);
    if (target !== undefined || (is.JSXElement(parent) && isComponentCall(parent))) {
      this.#forwarded.set(replacement, target ?? DEFAULT);
    }
    replaceChild(parent, element, replacement);
    this.parents.set(replacement, parent);
  }

  /** Move a component call's marked children to its `slot:<name>` props. */
  call(element: JsxElement): void {
    const groups = new Map<string, Node[]>();
    const kept: Node[] = [];
    for (const child of element.children) {
      const target = this.#target(child);
      if (target === undefined || target === DEFAULT) {
        kept.push(child);
      } else {
        groups.set(target, [...groups.get(target) ?? [], child]);
      }
    }
    if (groups.size === 0) return;
    element.children = kept as typeof element.children;
    const attributes = element.openingElement.attributes;
    for (const [name, parts] of groups) {
      // Marked content replaces a `slot:x={…}` written on the call, as nested children replace `children`.
      const written = attributes.findIndex((attribute) => is.JSXAttribute(attribute) && is.JSXNamespacedName(attribute.name)
        && attribute.name.namespace.name === 'slot' && attribute.name.name.name === name);
      if (written !== -1) attributes.splice(written, 1);
      const value = parts.length === 1 ? partValue(parts[0]!) : fragment(parts);
      attributes.push(b.JSXAttribute({
        name: b.JSXNamespacedName({ namespace: b.JSXIdentifier({ name: 'slot' }), name: b.JSXIdentifier({ name }) }),
        value: b.JSXExpressionContainer({ expression: value }),
      }) as (typeof attributes)[number]);
    }
  }

  /** The slot a direct child of a call goes to; undefined for the default one. */
  #target(child: Node): string | undefined {
    const forwarded = this.#forwarded.get(child);
    if (forwarded !== undefined) return forwarded;
    if (is.JSXElement(child)) return takeMarker(child);
    if (!is.JSXExpressionContainer(child) || is.JSXEmptyExpression(child.expression)) return undefined;
    const leaves = jsxLeaves(child.expression);
    const marked = leaves.filter((leaf) => staticAttribute(leaf, 'slot', false) !== undefined);
    if (marked.length === 0) return undefined;
    const names = new Set(marked.map((leaf) => staticAttribute(leaf, 'slot', false)));
    if (marked.length !== leaves.length || names.size !== 1) {
      throw new Error('reference: every element an expression child can give must target the same slot');
    }
    for (const leaf of marked) takeMarker(leaf);
    return [...names][0];
  }

  /** The nearest enclosing function named as a component, or a default-exported one. */
  #component(element: JsxElement): FunctionNode {
    for (let node = this.parents.get(element); node !== undefined; node = this.parents.get(node)) {
      if (!is.Function(node)) continue;
      const fn = node as FunctionNode;
      const name = functionName(fn, this.parents.get(fn));
      if ((name !== undefined && /^[A-Z]/.test(name)) || is.ExportDefaultDeclaration(this.parents.get(fn))) return fn;
    }
    throw new Error('reference: <slot> must be inside a component');
  }

  /** The expression that reads `name`'s content in `component`, adding it to the props first. */
  #value(component: FunctionNode, name: string): string {
    let values = this.#values.get(component);
    if (values === undefined) this.#values.set(component, values = new Map());
    const known = values.get(name);
    if (known !== undefined) return known;

    const key = name === DEFAULT ? 'children' : `slot:${name}`;
    const param = component.params[0];
    let value: string;
    if (param !== undefined && is.Identifier(param)) {
      value = name === DEFAULT ? `${param.name}.children` : `${param.name}[${JSON.stringify(key)}]`;
    } else {
      const pattern = this.#pattern(component);
      const existing = pattern.properties.find((entry) => is.Property(entry) && propertyKey(entry) === key && is.Identifier(entry.value));
      if (existing !== undefined && is.Property(existing) && is.Identifier(existing.value)) {
        value = existing.value.name;
      } else {
        value = this.#freshName(`$slot_${name === DEFAULT ? 'default' : name.replace(/[^\w$]/g, '_')}`);
        const entry = {
          type: 'Property', kind: 'init', method: false, shorthand: false, computed: false,
          key: name === DEFAULT ? b.Identifier({ name: key }) : b.Literal({ value: key, raw: JSON.stringify(key) }),
          value: b.Identifier({ name: value }),
          start: 0, end: 0,
        } as unknown as ObjectPattern['properties'][number];
        const rest = pattern.properties.findIndex((entry) => is.RestElement(entry));
        pattern.properties.splice(rest === -1 ? pattern.properties.length : rest, 0, entry);
      }
    }
    values.set(name, value);
    return value;
  }

  /** The component's props pattern, made when it takes no props. */
  #pattern(component: FunctionNode): ObjectPattern {
    const param = component.params[0];
    if (param === undefined) {
      const pattern = { type: 'ObjectPattern', properties: [], start: 0, end: 0 } as unknown as ObjectPattern;
      component.params.push(pattern as (typeof component.params)[number]);
      return pattern;
    }
    if (is.ObjectPattern(param)) return param;
    if (is.AssignmentPattern(param) && is.ObjectPattern(param.left)) return param.left;
    throw new Error('reference: a component with slots takes its props as a name or an object pattern');
  }

  #freshName(base: string): string {
    let name = base;
    for (let suffix = 2; this.source.includes(name); suffix++) name = `${base}${suffix}`;
    return name;
  }
}

/** Every node's parent, for the walk up to a placeholder's component. */
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

function isPlaceholder(element: JsxElement): boolean {
  return is.JSXIdentifier(element.openingElement.name) && element.openingElement.name.name === 'slot';
}

function isComponentCall(element: JsxElement): boolean {
  const name = element.openingElement.name;
  return is.JSXMemberExpression(name) || (is.JSXIdentifier(name) && /^[A-Z]/.test(name.name));
}

/** A static string attribute; `required` rejects any other value. */
function staticAttribute(element: Node, name: string, required: boolean): string | undefined {
  if (!is.JSXElement(element)) return undefined;
  const attribute = element.openingElement.attributes.find((entry) => {
    return is.JSXAttribute(entry) && is.JSXIdentifier(entry.name) && entry.name.name === name;
  });
  if (attribute === undefined || !is.JSXAttribute(attribute)) return undefined;
  const value = attribute.value;
  if (value !== null && is.Literal(value) && typeof value.value === 'string' && value.value !== '') return value.value;
  if (required || name === 'slot') throw new Error(`reference: a slot's ${name} must be a non-empty string`);
  return undefined;
}

/** Remove a child's `slot="x"` marker and return `x`. */
function takeMarker(element: JsxElement): string | undefined {
  const target = staticAttribute(element, 'slot', false);
  if (target === undefined) return undefined;
  const attributes = element.openingElement.attributes;
  attributes.splice(attributes.findIndex((entry) => is.JSXAttribute(entry) && is.JSXIdentifier(entry.name) && entry.name.name === 'slot'), 1);
  return target;
}

/** The elements an expression child can give: through `?:`, `&&`, `||`, `??` and a `.map` callback. */
function jsxLeaves(expression: Node): JsxElement[] {
  if (is.ParenthesizedExpression(expression)) return jsxLeaves(expression.expression);
  if (is.JSXElement(expression)) return [expression];
  if (is.ConditionalExpression(expression)) return [...jsxLeaves(expression.consequent), ...jsxLeaves(expression.alternate)];
  if (is.LogicalExpression(expression)) return [...jsxLeaves(expression.left), ...jsxLeaves(expression.right)];
  if (is.CallExpression(expression) && is.MemberExpression(expression.callee) && !expression.callee.computed
    && is.Identifier(expression.callee.property) && expression.callee.property.name === 'map') {
    const callback = expression.arguments[0];
    if (callback !== undefined && (is.ArrowFunctionExpression(callback) || is.FunctionExpression(callback))) {
      if (callback.body === null) return [];
      if (!is.BlockStatement(callback.body)) return jsxLeaves(callback.body);
      return findAll(callback.body, 'ReturnStatement').flatMap((returned) => returned.argument === null ? [] : jsxLeaves(returned.argument));
    }
  }
  return [];
}

/** A JSX child that is only the line breaks and indentation between children, which JSX drops. */
function isLayoutText(child: Node): boolean {
  return is.JSXText(child) && /^\s*$/.test(child.value) && child.value.includes('\n');
}

function functionName(fn: FunctionNode, parent: Node | undefined): string | undefined {
  if (fn.id) return fn.id.name;
  if (is.VariableDeclarator(parent) && is.Identifier(parent.id)) return parent.id.name;
  if (is.Property(parent) && !parent.computed && is.Identifier(parent.key)) return parent.key.name;
  return undefined;
}

function propertyKey(entry: Extract<Node, { type: 'Property' }>): string | undefined {
  if (!entry.computed && is.Identifier(entry.key)) return entry.key.name;
  if (is.Literal(entry.key) && typeof entry.key.value === 'string') return entry.key.value;
  return undefined;
}

/** A moved child as a prop's value: an element as itself, an expression child as its expression. */
function partValue(part: Node): Expression {
  if (is.JSXExpressionContainer(part) && !is.JSXEmptyExpression(part.expression)) return part.expression as Expression;
  return part as Expression;
}

function fragment(children: readonly Node[]): Expression {
  return b.JSXFragment({
    openingFragment: b.JSXOpeningFragment({}),
    closingFragment: b.JSXClosingFragment({}),
    children: children as never,
  }) as unknown as Expression;
}

function parseExpression(text: string): Expression {
  const { program } = parse(`(${text});`, { lang: 'tsx', sourceType: 'module' });
  const statement = program.body[0]!;
  if (!is.ExpressionStatement(statement)) throw new Error(`reference: not an expression: ${text}`);
  return is.ParenthesizedExpression(statement.expression) ? statement.expression.expression : statement.expression;
}

function replaceChild(parent: Node, child: Node, replacement: Node): void {
  for (const [key, value] of Object.entries(parent)) {
    if (value === child) {
      (parent as unknown as Record<string, unknown>)[key] = replacement;
      return;
    }
    if (Array.isArray(value)) {
      const index = value.indexOf(child);
      if (index !== -1) {
        value[index] = replacement;
        return;
      }
    }
  }
  throw new Error('reference: a slot placeholder lost its parent');
}
