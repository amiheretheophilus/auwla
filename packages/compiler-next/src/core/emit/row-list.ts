/**
 * The rows of a text site whose value is a proven `map` call
 * (`optimize/row-lists.ts`, `runtime/src/row-list.ts`): a key function and a
 * row factory, declared where the callback is evaluated so they read the same
 * bindings. The factory takes the callback's own parameter names; a row's
 * update assigns them, so handlers created with the row read the current item.
 *
 * A leaf component row is compiled once more at module level, beside the
 * component, as `function _Row_row(props, owner)`: its template and sites with
 * the props object as its parameter, which the row's update assigns.
 */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { ModulePlan, RowListPlan, Site, Template } from '../plan/model';
import type { FunctionNode } from '../resolve/functions';
import type { Names } from './names';
import { copy } from './copy';
import { expression, statement, stringLiteral } from './quote';
import { emitNodes, inheritedNodes } from './template';
import { emitSites, renderOwner, type SitesContext } from './sites';
import { emitMutations } from '../../features/handlers/mutations';

type BlockStatement = Extract<Statement, { type: 'BlockStatement' }>;

/** `const list = createRowList(anchor, owner, key, create);`, declared before the site is evaluated. */
export function emitRowList(plan: RowListPlan, anchor: string, context: SitesContext): {
  readonly list: string;
  readonly declarations: readonly Statement[];
} {
  const { names, runtime, replacements } = context;
  const list = names.of(plan.call, '_rowList');
  const params = plan.callback.params.map((param) => (param as { name: string }).name);
  const namespace = names.fresh('_rowNamespace');
  const declarations: Statement[] = [
    statement('const $$namespace = $$runtime.renderNamespace($$anchor.parentNode, $$inherited);', {
      namespace, runtime, anchor, inherited: context.namespace ?? expression('void 0'),
    }),
  ];

  let body: Statement[];
  if (plan.row.kind === 'element') {
    const value = plan.row.value;
    const sites = value.keyIndex === null ? value.sites : value.sites.filter((_, index) => index !== value.keyIndex);
    const variant = (shape: Template) => emitRow(shape, sites, { ...context, namespace }, (emitted, root) => {
      const next = params.map((param) => names.fresh(`_${param}`));
      return entry(root, next, [...assign(params, next), ...emitted.update], emitted.dispose);
    });
    // Stored JSX takes the namespace where it is shown (`render-value.ts`); a
    // row list is shown at one anchor, so its rows choose once.
    body = inheritedNodes(value.template).size > 0
      ? [b.IfStatement({
        test: expression('$$namespace === "svg"', { namespace }),
        consequent: b.BlockStatement({ body: variant(value.svgTemplate) }),
        alternate: null,
      }), ...variant(value.template)]
      : variant(value.template);
  } else {
    const rows = context.rowComponents;
    if (rows === undefined) throw new Error('memo-dom: a component row list needs the module\'s row components');
    const owner = names.fresh('_rowOwner');
    const value = renderOwner({ ...context, namespace });
    if (value.type === 'ObjectExpression') {
      // A row's handler edit of its props re-renders the list (`RowComponents`).
      value.properties.push(b.Property({
        key: b.Identifier({ name: 'invalidate' }), value: expression('() => $$list.invalidate()', { list }),
        kind: 'init', method: false, shorthand: false, computed: false,
      }) as (typeof value.properties)[number]);
    }
    declarations.push(statement('const $$owner = $$value;', { owner, value }));
    const props = () => b.ObjectExpression({
      properties: (plan.row as Extract<RowListPlan['row'], { kind: 'component' }>).props.map(({ name, value }) => b.Property({
        key: stringLiteral(name), value: copy(value, replacements), kind: 'init',
        method: false, shorthand: false, computed: false,
      }) as Extract<Expression, { type: 'ObjectExpression' }>['properties'][number]),
    });
    const row = names.fresh('_row');
    const next = params.map((param) => names.fresh(`_${param}`));
    body = [
      statement('const $$row = $$factory($$props, $$owner);', { row, factory: rows.factory(plan.row.component), props: props(), owner }),
      b.ReturnStatement({ argument: entry(`${row}.node`, next, [
        ...assign(params, next),
        statement('$$row.update($$props);', { row, props: props() }),
      ], [statement('$$row.dispose();', { row })]) }),
    ];
  }
  const create = arrow(params, b.BlockStatement({ body }));
  const key = plan.key === null ? expression('null') : arrow(params, copy(plan.key, replacements));
  declarations.push(statement('const $$list = $$runtime.createRowList($$anchor, $$owner, $$key, $$create);', {
    list, runtime, anchor, owner: renderOwner(context), key, create,
  }));
  return { list, declarations };
}

/** Leaf component rows, each compiled once per module (`emitRowList`). */
export class RowComponents {
  readonly declarations: Statement[] = [];
  readonly #factories = new Map<Node, string>();

  constructor(
    private readonly plan: ModulePlan,
    private readonly names: Names,
    private readonly runtime: string,
    /** Module-wide rewrites only: the copy reads its props without the component's own tracking. */
    private readonly replacements: ReadonlyMap<Node, Node>,
  ) {}

  factory(fn: FunctionNode): string {
    let name = this.#factories.get(fn);
    if (name !== undefined) return name;
    const component = this.plan.components.get(fn)!;
    const { names, runtime } = this;
    name = names.fresh(`_${is.FunctionDeclaration(fn) && fn.id !== null ? fn.id.name : 'component'}_row`);
    this.#factories.set(fn, name);
    const param = fn.params[0];
    const props = param !== undefined && is.Identifier(param) ? param.name : names.fresh('_props');
    const owner = names.fresh('_rowOwner');
    const document = names.fresh('_document');
    const id = names.fresh('_rowId');
    const batch = names.fresh('_rowWrites');
    const entity = names.fresh('_rowEntity');
    const namespace = names.fresh('_rowNamespace');
    // Its handlers' edits of its props stay observed, as in the component;
    // they notify the list, which shows its rows again (`optimize/row-lists.ts`).
    const invalidate = names.fresh('_invalidate');
    const handlers = emitMutations(component.mutations, new Map(), names, runtime, null, this.replacements, new Map(),
      new Map(component.state.map((binding) => [binding, invalidate])));
    const context: SitesContext = {
      names, runtime, batch, entity, id, document, namespace,
      versions: new Map(), replacements: handlers.replacements, ref: () => '', rows: true,
    };
    const body = emitRow(component.template, component.sites, context, (emitted, root) => {
      const next = names.fresh('_nextProps');
      // The general receiver keeps the props object while its fields are the
      // same. Where the object is only read through members, its identity is
      // unobservable, so the row takes the new object without comparing.
      const receive = param !== undefined && is.Identifier(param) && !membersOnly(this.plan, param)
        ? statement('if (!$$runtime.sameProps($$props, $$next)) $$props = $$next;', { runtime, props, next })
        : statement('$$props = $$next;', { props, next });
      return entry(root, [next], [receive, ...emitted.update], emitted.dispose);
    }, true);
    const declaration = statement(`function ${name}($$props, $$owner) {}`, { props, owner });
    if (is.FunctionDeclaration(declaration)) {
      declaration.body!.body = [
        statement('const $$document = $$runtime.getActiveEnvironment().document;', { document, runtime }),
        statement('const $$id = $$owner.id;', { id, owner }),
        statement('const $$batch = $$owner.batch;', { batch, owner }),
        statement('const $$entity = $$owner.entity;', { entity, owner }),
        statement('const $$namespace = $$owner.namespace;', { namespace, owner }),
        ...(component.mutations.length === 0 ? [] : [statement('const $$invalidate = $$owner.invalidate;', { invalidate, owner })]),
        ...handlers.declarations,
        ...body,
      ];
    }
    this.declarations.push(declaration);
    return name;
  }
}

/** Whether every use of the parameter reads a member, never calling one with it as `this`. */
function membersOnly(plan: ModulePlan, param: Extract<Node, { type: 'Identifier' }>): boolean {
  const module = plan.module.module;
  const binding = module.bindings.find((candidate) => candidate.declarations[0] === param);
  if (binding === undefined) return false;
  return binding.references.every((reference) => {
    if (reference.inTypePosition) return true;
    const parent = module.parentOf(reference.node);
    if (reference.isWrite || !is.MemberExpression(parent) || parent.object !== reference.node) return false;
    const grandparent = module.parentOf(parent);
    return !(is.CallExpression(grandparent) && grandparent.callee === parent);
  });
}

/** A row's nodes and sites, ending with the entry `finish` returns for its root. */
function emitRow(
  shape: Template,
  sites: readonly Site[],
  context: SitesContext,
  finish: (emitted: ReturnType<typeof emitSites>, root: string) => Expression,
  /** A component's template takes its namespace at mount; an element row's variant is chosen already. */
  inherits = false,
): Statement[] {
  const { names, runtime } = context;
  const markup = shape.markup === null ? null : names.fresh('_rowMarkup');
  const slots = emitNodes(shape, sites, {
    names, runtime, document: context.document, markup, namespace: inherits ? context.namespace : undefined,
  });
  const emitted = emitSites({ sites, siteInputs: new Map(), dynamicSites: new Set() },
    { ...context, ref: slots.ref, rows: true, once: undefined });
  return [
    ...(markup === null ? [] : [statement('const $$markup = $$html;', { markup, html: stringLiteral(shape.markup!) })]),
    ...slots.statements,
    ...emitted.mount,
    b.ReturnStatement({ argument: finish(emitted, slots.root(shape.roots[0]!)) }),
  ];
}

function assign(params: readonly string[], next: readonly string[]): Statement[] {
  return params.map((param, index) => statement('$$param = $$next;', { param, next: next[index]! }));
}

/** `{ node, update(...next) { … }, dispose() { … } }`. */
function entry(node: string, next: readonly string[], update: readonly Statement[], dispose: readonly Statement[]): Expression {
  const value = expression('({ node: $$node, update() {}, dispose() {} })', { node: expression(node) });
  if (value.type !== 'ObjectExpression') return value;
  for (const property of value.properties) {
    if (property.type !== 'Property' || property.key.type !== 'Identifier' || property.value.type !== 'FunctionExpression') {
      continue;
    }
    if (property.key.name === 'update') {
      property.value.params = next.map((name) => b.Identifier({ name }));
      property.value.body!.body = [...update];
    } else if (property.key.name === 'dispose') {
      property.value.body!.body = [...dispose];
    }
  }
  return value;
}

function arrow(params: readonly string[], body: Expression | BlockStatement): Expression {
  return b.ArrowFunctionExpression({
    id: null,
    params: params.map((name) => b.Identifier({ name })),
    body,
    async: false,
    generator: false,
    expression: body.type !== 'BlockStatement',
  });
}
