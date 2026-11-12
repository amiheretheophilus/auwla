/**
 * Component slots, lowered to props before analysis (`wiki/compiler/components.md`, "Slots").
 * Lowercase `<slot>` is compiler syntax, never an element. After this, every later stage sees
 * ordinary JSX and props, so slot content gets the same tracking, rows and delivery as any prop.
 *
 *     function Panel({ tone }) {                    function Panel({ tone, children: $slot_default,
 *       return <section class={tone}>                                "slot:header": $slot_header }) {
 *         <slot name="header">Untitled</slot>         return <section class={tone}>
 *         <slot />                                       {$slot_header !== void 0 ? $slot_header : <>Untitled</>}
 *       </section>;                                      {$slot_default}
 *     }                                                </section>;
 *                                                    }
 *     <Panel><h1 slot="header">A</h1><p>B</p></Panel>
 *                                                    <Panel slot:header={<h1>A</h1>}><p>B</p></Panel>
 *
 * - The default slot is the `children` prop, a named slot the prop `slot:<name>`, which no
 *   authored prop name can collide with and an element never takes as an attribute
 *   (`runtime/src/dom-props.ts`). Adding the key to a props pattern also keeps it out of `...rest`.
 * - A placeholder's own children are its fallback, shown while the slot's value is `undefined`,
 *   as a default parameter is. So `{false}` is content that shows nothing, and `{undefined}` is not.
 * - A direct child of a component call marked `slot="x"` goes to `slot:x`, in authored order, and
 *   loses the marker. So does a direct expression child whose elements are all marked `x`
 *   (`{cond && <b slot="x" />}`, `{items.map((item) => <li slot="x" />)}`).
 * - A placeholder written as a direct child of a component call forwards: its `name` reads the
 *   enclosing component's slot, its `slot` picks the inner component's. Alone in its group it
 *   passes on `undefined`, so the inner component's own fallback shows.
 *
 * Errors, each a mistake with no meaning: a dynamic or empty slot name or marker, a marker that is
 * not on a direct child of a component call, an expression child whose elements target different
 * slots, `<slot>` outside a component, and content for a slot that a component in the same module
 * does not declare (when its props cannot pass content on through a name or `...rest`).
 */
import { findAll, is } from 'yuku-ast';
import { parse } from 'yuku-parser';
import type { Node } from 'yuku-parser';
import { CompileError } from '../../core/diagnostics';
import { applyEditsWithOrigin, TracedText, UNEDITED, type Edit, type TextOrigin } from '../../core/parse/text-edits';

type JsxElement = Extract<Node, { type: 'JSXElement' }>;
type JsxAttribute = Extract<Node, { type: 'JSXAttribute' }>;
type FunctionNode = Extract<Node, { type: 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression' }>;
type ObjectPattern = Extract<Node, { type: 'ObjectPattern' }>;

/** The default slot's name. A named slot always has a non-empty one. */
const DEFAULT = '';

/** Whether the text can contain slot syntax at all, before parsing it again. */
export function mayHaveSlots(source: string): boolean {
  return /<slot\b|\sslot=/.test(source);
}

/** The module's text with its slots lowered to props. */
export function lowerSlots(path: string, source: string): string {
  return lowerSlotsWithOrigin(path, source).text;
}

/** `lowerSlots`, and where each part of the lowered text came from (`core/parse/text-edits.ts`). */
export function lowerSlotsWithOrigin(path: string, source: string): { text: string; origin: TextOrigin } {
  if (!mayHaveSlots(source)) return { text: source, origin: UNEDITED };
  const { program } = parse(source, { lang: 'tsx', sourceType: 'module' });
  const lowering = new Lowering(path, source, program);
  return lowering.run();
}

/** One slot a component shows: how its content is read there. */
interface ComponentSlots {
  readonly component: FunctionNode;
  /** Slot name → the expression reading its content. */
  readonly reads: Map<string, string>;
  /** Pattern entries to add, in order (`"slot:header": $slot_header`). */
  readonly entries: string[];
}

class Lowering {
  readonly #parents: Map<Node, Node>;
  readonly #edits: Edit[] = [];
  readonly #components = new Map<FunctionNode, ComponentSlots>();
  /** A placeholder that is a direct child of a component call, and the inner slot it fills. */
  readonly #forwarded = new Map<JsxElement, string>();
  /** Markers this lowering consumed; any other is misplaced. */
  readonly #consumed = new Set<JsxAttribute>();
  /** Each call's named slots that its children fill, with the first child for each. */
  readonly #supplied = new Map<JsxElement, Map<string, Node>>();

  constructor(private readonly path: string, private readonly source: string, private readonly program: Node) {
    this.#parents = parentsOf(program);
  }

  run(): { text: string; origin: TextOrigin } {
    const elements = findAll(this.program, 'JSXElement');
    for (const element of elements) {
      if (isPlaceholder(element)) this.#placeholder(element);
    }
    for (const slots of this.#components.values()) this.#addProps(slots);
    // Innermost calls first, so a moved child's text already holds its own lowering.
    const calls = elements.filter(isComponentCall).sort((left, right) => (left.end - left.start) - (right.end - right.start));
    for (const call of calls) this.#call(call);
    this.#checkDeclaredSlots(calls);
    for (const attribute of findAll(this.program, 'JSXAttribute')) {
      if (isMarker(attribute) && !this.#consumed.has(attribute)) {
        throw this.#error('a slot marker belongs on a direct child of a component', attribute);
      }
    }
    return applyEditsWithOrigin(this.source, this.#edits);
  }

  /** `<slot name="x">fallback</slot>` → the slot's content, or the fallback while it is undefined. */
  #placeholder(element: JsxElement): void {
    const component = this.#componentOf(element);
    const name = this.#staticAttribute(element, 'name') ?? DEFAULT;
    const read = this.#read(component, name);
    const parent = this.#parents.get(element)!;
    const inJsx = is.JSXElement(parent) || is.JSXFragment(parent);
    const [open, close] = inJsx ? ['{', '}'] : ['(', ')'];
    const target = this.#staticAttribute(element, 'slot');
    if (target !== undefined || (is.JSXElement(parent) && isComponentCall(parent))) {
      this.#forwarded.set(element, target ?? DEFAULT);
      const marker = markerOf(element);
      if (marker !== undefined) this.#consumed.add(marker);
    }

    const fallback = element.children.some((child) => !isLayoutText(child));
    if (!fallback || element.closingElement === null) {
      this.#edits.push({ start: element.start, end: element.end, text: `${open}${read}${close}` });
      return;
    }
    this.#edits.push({
      start: element.openingElement.start, end: element.openingElement.end,
      text: `${open}${read} !== void 0 ? ${read} : <>`,
    });
    this.#edits.push({ start: element.closingElement.start, end: element.closingElement.end, text: `</>${close}` });
  }

  /** How `component` reads `name`'s content, planning the props entry that provides it. */
  #read(component: FunctionNode, name: string): string {
    let slots = this.#components.get(component);
    if (slots === undefined) this.#components.set(component, slots = { component, reads: new Map(), entries: [] });
    const known = slots.reads.get(name);
    if (known !== undefined) return known;

    const key = name === DEFAULT ? 'children' : `slot:${name}`;
    const param = component.params[0];
    let read: string;
    if (param !== undefined && is.Identifier(param)) {
      read = name === DEFAULT ? `${param.name}.children` : `${param.name}[${JSON.stringify(key)}]`;
    } else {
      const pattern = this.#patternOf(component);
      const existing = pattern?.properties.find((entry) => is.Property(entry) && keyOf(entry) === key && is.Identifier(entry.value));
      if (existing !== undefined && is.Property(existing) && is.Identifier(existing.value)) {
        read = existing.value.name;
      } else {
        read = this.#freshName(`$slot_${name === DEFAULT ? 'default' : name.replace(/[^\w$]/g, '_')}`);
        slots.entries.push(`${name === DEFAULT ? 'children' : JSON.stringify(key)}: ${read}`);
      }
    }
    slots.reads.set(name, read);
    return read;
  }

  /** Add the planned entries to the component's props pattern, or give it one. */
  #addProps(slots: ComponentSlots): void {
    if (slots.entries.length === 0) return;
    const entries = slots.entries.join(', ');
    const pattern = this.#patternOf(slots.component);
    if (pattern === null) {
      // No props yet: `function Panel()` → `function Panel({ children: $slot_default })`.
      const open = this.source.indexOf('(', slots.component.id?.end ?? slots.component.start);
      this.#edits.push({ start: open + 1, end: open + 1, text: `{ ${entries} }` });
      return;
    }
    const rest = pattern.properties.find((entry) => is.RestElement(entry));
    if (rest !== undefined) {
      this.#edits.push({ start: rest.start, end: rest.start, text: `${entries}, ` });
    } else if (pattern.properties.length > 0) {
      this.#edits.push({ start: pattern.properties.at(-1)!.end, end: pattern.properties.at(-1)!.end, text: `, ${entries}` });
    } else {
      this.#edits.push({ start: pattern.start + 1, end: pattern.start + 1, text: ` ${entries} ` });
    }
  }

  /** The component's props pattern; null when it takes no props. */
  #patternOf(component: FunctionNode): ObjectPattern | null {
    const param = component.params[0];
    if (param === undefined) return null;
    if (is.ObjectPattern(param)) return param;
    if (is.AssignmentPattern(param) && is.ObjectPattern(param.left)) return param.left;
    throw this.#error('a component with slots takes its props as a name or an object pattern', param);
  }

  /** Move a component call's marked children to its `slot:<name>` props. */
  #call(call: JsxElement): void {
    const groups = new Map<string, Node[]>();
    for (const child of call.children) {
      const target = this.#targetOf(child);
      if (target !== undefined && target !== DEFAULT) groups.set(target, [...groups.get(target) ?? [], child]);
    }
    this.#supplied.set(call, new Map([...groups].map(([name, parts]) => [name, parts[0]!])));
    for (const [name, parts] of groups) {
      // Traced, so the moved content keeps its authored positions in source maps.
      const texts = parts.map((part) => this.#take(part));
      // A lowered placeholder is `{read}` as a child; as a prop's value it is `read`.
      const single = parts.length === 1 && (is.JSXExpressionContainer(parts[0]) || this.#forwarded.has(parts[0] as JsxElement));
      const value = parts.length > 1
        ? TracedText.join(['<>', ...texts, '</>'])
        : single ? texts[0]!.slice(1, texts[0]!.text.length - 1) : texts[0]!;
      // Before the opening tag's `>`: marked content replaces a `slot:x={…}` written on the call,
      // as nested children replace `children`, because a later attribute wins.
      const at = call.openingElement.end - 1;
      const traced = TracedText.join([` slot:${name}={`, value, '}']);
      this.#edits.push({ start: at, end: at, text: traced.text, traced });
    }
  }

  /** The slot a direct child of a call goes to; undefined for the default one. */
  #targetOf(child: Node): string | undefined {
    if (is.JSXElement(child) && this.#forwarded.has(child)) return this.#forwarded.get(child);
    if (is.JSXElement(child)) return this.#consumeMarker(child);
    if (!is.JSXExpressionContainer(child) || is.JSXEmptyExpression(child.expression)) return undefined;
    const leaves = jsxLeaves(child.expression);
    const marked = leaves.filter((leaf) => markerOf(leaf) !== undefined);
    if (marked.length === 0) return undefined;
    const names = new Set(marked.map((leaf) => this.#staticAttribute(leaf, 'slot')));
    if (marked.length !== leaves.length || names.size !== 1) {
      throw this.#error('every element an expression child gives must target the same slot', child);
    }
    for (const leaf of marked) this.#consumeMarker(leaf);
    return [...names][0];
  }

  /** Remove an element's `slot="x"` marker and return `x`. */
  #consumeMarker(element: JsxElement): string | undefined {
    const marker = markerOf(element);
    if (marker === undefined) return undefined;
    const name = this.#staticAttribute(element, 'slot')!;
    this.#consumed.add(marker);
    // With the space before it, so `<b slot="x">` becomes `<b>`.
    let start = marker.start;
    while (start > 0 && /\s/.test(this.source[start - 1]!)) start--;
    this.#edits.push({ start, end: marker.end, text: '' });
    return name;
  }

  /** A child's text with the edits inside it applied, removing it (and them) from where it was. */
  #take(part: Node): TracedText {
    const inside = this.#edits.filter((edit) => edit.start >= part.start && edit.end <= part.end);
    for (const edit of inside) this.#edits.splice(this.#edits.indexOf(edit), 1);
    const text = TracedText.edited(this.source, inside, part.start, part.end);
    this.#edits.push({ start: part.start, end: part.end, text: '' });
    return text;
  }

  /**
   * A call to a component of this module gets content only for slots that component shows, so a
   * misspelled slot is an error rather than content that silently goes nowhere. Not checked when
   * the component's props can pass content on (a name for the whole object, or `...rest`).
   */
  #checkDeclaredSlots(calls: readonly JsxElement[]): void {
    for (const call of calls) {
      const name = call.openingElement.name;
      if (!is.JSXIdentifier(name)) continue;
      const component = this.#moduleComponent(name.name);
      if (component === undefined || this.#passesPropsOn(component)) continue;
      const declared = this.#components.get(component)?.reads ?? new Map<string, string>();
      const supplied = new Map(this.#supplied.get(call));
      for (const attribute of call.openingElement.attributes) {
        if (is.JSXAttribute(attribute) && is.JSXNamespacedName(attribute.name) && attribute.name.namespace.name === 'slot') {
          supplied.set(attribute.name.name.name, attribute);
        }
      }
      for (const [slot, node] of supplied) {
        if (!declared.has(slot)) throw this.#error(`${name.name} has no slot '${slot}'`, node);
      }
    }
  }

  /** A component declared at the top of this module under `name`. */
  #moduleComponent(name: string): FunctionNode | undefined {
    if (!is.Program(this.program)) return undefined;
    for (const statement of this.program.body) {
      const declaration = is.ExportNamedDeclaration(statement) || is.ExportDefaultDeclaration(statement) ? statement.declaration : statement;
      if (is.FunctionDeclaration(declaration) && declaration.id?.name === name) return declaration;
      if (is.VariableDeclaration(declaration)) {
        for (const declarator of declaration.declarations) {
          if (is.Identifier(declarator.id) && declarator.id.name === name && declarator.init !== null
            && (is.ArrowFunctionExpression(declarator.init) || is.FunctionExpression(declarator.init))) return declarator.init;
        }
      }
    }
    return undefined;
  }

  /** Whether the component's props can carry content on: a name for the whole object, or `...rest`. */
  #passesPropsOn(component: FunctionNode): boolean {
    const param = component.params[0];
    if (param === undefined) return false;
    const pattern = is.AssignmentPattern(param) ? param.left : param;
    return !is.ObjectPattern(pattern) || pattern.properties.some((entry) => is.RestElement(entry));
  }

  /** The nearest enclosing function named as a component, or a default-exported one. */
  #componentOf(element: JsxElement): FunctionNode {
    for (let node = this.#parents.get(element); node !== undefined; node = this.#parents.get(node)) {
      if (!is.Function(node)) continue;
      const fn = node as FunctionNode;
      const parent = this.#parents.get(fn);
      const name = functionName(fn, parent);
      if ((name !== undefined && /^[A-Z]/.test(name)) || is.ExportDefaultDeclaration(parent)) return fn;
    }
    throw this.#error('<slot> belongs inside a component', element);
  }

  /** A static, non-empty string attribute. Any other value of `name` or `slot` is an error. */
  #staticAttribute(element: JsxElement, name: 'name' | 'slot'): string | undefined {
    const attribute = element.openingElement.attributes.find((entry) => {
      return is.JSXAttribute(entry) && is.JSXIdentifier(entry.name) && entry.name.name === name;
    });
    if (attribute === undefined || !is.JSXAttribute(attribute)) return undefined;
    const value = attribute.value;
    if (value !== null && is.Literal(value) && typeof value.value === 'string' && /^[A-Za-z_][\w-]*$/.test(value.value)) {
      return value.value;
    }
    throw this.#error(`a slot's ${name} must be a static name of letters, digits, '_' or '-'`, attribute);
  }

  #freshName(base: string): string {
    let name = base;
    for (let suffix = 2; this.source.includes(name); suffix++) name = `${base}${suffix}`;
    return name;
  }

  #error(message: string, node: Node): CompileError {
    return CompileError.at(message, this.path, this.source, node.start);
  }
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

function isPlaceholder(element: JsxElement): boolean {
  return is.JSXIdentifier(element.openingElement.name) && element.openingElement.name.name === 'slot';
}

function isComponentCall(element: JsxElement): boolean {
  const name = element.openingElement.name;
  return is.JSXMemberExpression(name) || (is.JSXIdentifier(name) && /^[A-Z]/.test(name.name));
}

function isMarker(attribute: JsxAttribute): boolean {
  return is.JSXIdentifier(attribute.name) && attribute.name.name === 'slot';
}

function markerOf(element: JsxElement): JsxAttribute | undefined {
  const marker = element.openingElement.attributes.find((entry) => is.JSXAttribute(entry) && isMarker(entry));
  return marker !== undefined && is.JSXAttribute(marker) ? marker : undefined;
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

/** The line breaks and indentation between JSX children, which JSX drops. */
function isLayoutText(child: Node): boolean {
  return is.JSXText(child) && /^\s*$/.test(child.value) && child.value.includes('\n');
}

function functionName(fn: FunctionNode, parent: Node | undefined): string | undefined {
  if (fn.id) return fn.id.name;
  if (is.VariableDeclarator(parent) && is.Identifier(parent.id)) return parent.id.name;
  if (is.Property(parent) && !parent.computed && is.Identifier(parent.key)) return parent.key.name;
  return undefined;
}

function keyOf(entry: Extract<Node, { type: 'Property' }>): string | undefined {
  if (!entry.computed && is.Identifier(entry.key)) return entry.key.name;
  if (is.Literal(entry.key) && typeof entry.key.value === 'string') return entry.key.value;
  return undefined;
}

