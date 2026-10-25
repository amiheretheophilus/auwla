/**
 * The rows of a text site whose value is a proven `map` call
 * (`optimize/row-lists.ts`, `runtime/src/row-list.ts`): a key function and a
 * row factory, declared where the callback is evaluated so they read the same
 * bindings. The factory takes the callback's own parameter names; a row's
 * update assigns them, so handlers created with the row read the current item.
 */
import { b } from 'yuku-ast';
import type { Expression, Statement } from 'yuku-parser';
import type { RowListPlan, Template } from '../plan/model';
import { copy } from './copy';
import { expression, statement, stringLiteral } from './quote';
import { emitTemplate, inheritedNodes, prepareTemplateSites } from './template';
import { emitSites, type SitesContext } from './sites';

/** `const list = createRowList(anchor, owner, key, create);`, declared before the site is evaluated. */
export function emitRowList(plan: RowListPlan, anchor: string, owner: Expression, context: SitesContext): {
  readonly list: string;
  readonly declarations: readonly Statement[];
} {
  const { names, runtime, replacements } = context;
  const list = names.of(plan.call, '_rowList');
  const params = plan.callback.params.map((param) => (param as { name: string }).name);
  const namespace = names.fresh('_rowNamespace');
  const keySite = plan.row.keyIndex === null ? null : plan.row.sites[plan.row.keyIndex]!;
  const sites = plan.row.sites.filter((site) => site !== keySite);

  const variant = (shape: Template): Statement[] => {
    const markup = shape.markup === null ? null : names.fresh('_rowMarkup');
    const used = new Set(shape.roots);
    for (const site of sites) used.add(site.node);
    const templateContext = { names, runtime, document: context.document, markup };
    const template = emitTemplate(shape, used, templateContext);
    const slots = prepareTemplateSites(shape, sites, template, templateContext);
    const emitted = emitSites(
      { sites, siteInputs: new Map(), dynamicSites: new Set() },
      { ...context, ref: slots.ref, namespace, rows: true, once: undefined },
    );
    const next = params.map((param) => names.fresh(`_${param}`));
    const update: Statement[] = [
      ...params.map((param, index) => statement('$$param = $$next;', { param, next: next[index]! })),
      ...emitted.update,
    ];
    const entry = expression('({ node: $$node, update() {}, dispose() {} })', { node: slots.root(shape.roots[0]!) });
    fillMethods(entry, { update, dispose: emitted.dispose }, next);
    return [
      ...(markup === null ? [] : [statement('const $$markup = $$html;', { markup, html: stringLiteral(shape.markup!) })]),
      ...template.statements,
      ...slots.statements,
      ...emitted.mount,
      b.ReturnStatement({ argument: entry }),
    ];
  };

  // Stored JSX takes the namespace where it is shown (`render-value.ts`); a
  // row list is shown at one anchor, so its rows choose once.
  const body = inheritedNodes(plan.row.template).size > 0
    ? [b.IfStatement({
      test: expression('$$namespace === "svg"', { namespace }),
      consequent: b.BlockStatement({ body: variant(plan.row.svgTemplate) }),
      alternate: null,
    }), ...variant(plan.row.template)]
    : variant(plan.row.template);
  const create = arrow(params, b.BlockStatement({ body }));
  const key = keySite === null ? expression('null') : arrow(params, copy(keySite.expression, replacements));
  return {
    list,
    declarations: [
      statement('const $$namespace = $$runtime.renderNamespace($$anchor.parentNode, $$inherited);', {
        namespace, runtime, anchor, inherited: context.namespace ?? expression('void 0'),
      }),
      statement('const $$list = $$runtime.createRowList($$anchor, $$owner, $$key, $$create);', {
        list, runtime, anchor, owner, key, create,
      }),
    ],
  };
}

function arrow(params: readonly string[], body: Expression | Extract<Statement, { type: 'BlockStatement' }>): Expression {
  return b.ArrowFunctionExpression({
    id: null,
    params: params.map((name) => b.Identifier({ name })),
    body,
    async: false,
    generator: false,
    expression: body.type !== 'BlockStatement',
  });
}

function fillMethods(
  entry: Expression,
  bodies: { readonly update: readonly Statement[]; readonly dispose: readonly Statement[] },
  updateParams: readonly string[],
): void {
  if (entry.type !== 'ObjectExpression') return;
  for (const property of entry.properties) {
    if (property.type !== 'Property' || property.key.type !== 'Identifier' || property.value.type !== 'FunctionExpression') {
      continue;
    }
    if (property.key.name === 'update') {
      property.value.params = updateParams.map((name) => b.Identifier({ name }));
      property.value.body!.body = [...bodies.update];
    } else if (property.key.name === 'dispose') {
      property.value.body!.body = [...bodies.dispose];
    }
  }
}
