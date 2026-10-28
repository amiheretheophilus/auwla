/** A stored JSX expression captures native values for a compiled binding program. */
import { b } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { RenderValuePlan, Site } from '../plan/model';
import type { Names } from './names';
import { expression, statement } from './quote';
import { emitNodes } from './template';
import { emitSites } from './sites';

export function emitRenderValue(plan: RenderValuePlan, names: Names, runtime: string, sourceValues = false) {
  const program = names.fresh('_renderProgram');
  const values = names.fresh('_values');
  const next = names.fresh('_values');
  const owner = names.fresh('_owner');
  const id = names.fresh('_valueId');
  const entity = names.fresh('_valueEntity');
  const batch = names.fresh('_valueWrites');
  const document = names.fresh('_document');
  const namespace = names.fresh('_namespace');

  // The consuming slot chooses the namespace. The shared template emitter
  // already handles inherited SVG, foreignObject, and per-namespace cloning;
  // only node creation differs, not the site's updates or disposal program.
  const shape = plan.template;
  const slots = emitNodes(shape, plan.sites, { names, runtime, document, namespace });
  const sites = emitSites(
    { sites: plan.sites, siteInputs: new Map(), dynamicSites: new Set() },
    {
      names,
      runtime,
      document,
      id,
      entity,
      batch,
      values,
      sourceValues,
      namespace,
      versions: new Map(),
      replacements: new Map(),
      ref: slots.ref,
    },
  );
  const roots = shape.roots.map(slots.root);
  const entry = renderEntry(roots, next, [
    statement('$$values = $$next;', { values, next }),
    ...sites.update,
  ], sites.dispose);

  const mountBody = [
    statement('const $$document = $$runtime.getActiveEnvironment().document;', { document, runtime }),
    statement('const $$id = $$owner.id;', { id, owner }),
    statement('const $$entity = $$owner.entity;', { entity, owner }),
    statement('const $$batch = $$owner.batch;', { batch, owner }),
    statement('const $$namespace = $$owner.namespace;', { namespace, owner }),
    ...slots.statements,
    ...sites.mount,
    b.ReturnStatement({ argument: entry }),
  ];
  const declaration = programDeclaration(program, values, owner, mountBody);

  // Captures stay at the authored expression, outside the hoisted program.
  // Moving them into mount would change lexical access and evaluation order.
  const captured = b.ArrayExpression({ elements: plan.sites.map((site) => siteValue(site)) });
  const value = plan.keyIndex === null
    ? expression('$$runtime.createRenderValue($$program, $$values)', { runtime, program, values: captured })
    : expression('$$runtime.createKeyedRenderValue($$program, $$values, $$index)', {
      runtime,
      program,
      values: captured,
      index: b.Literal({ value: plan.keyIndex, raw: String(plan.keyIndex) }),
    });
  return { declaration: declaration as Statement, replacement: value as Node };
}

/** What a site captures: its expression, or `[...items]` for spread children. */
export function siteValue(site: Site): Expression {
  if (site.kind === 'text' && site.spread === true) {
    return expression('[...$$items]', { items: site.expression });
  }
  return site.expression;
}

function renderEntry(
  roots: readonly string[],
  next: string,
  update: readonly Statement[],
  dispose: readonly Statement[],
): Expression {
  const entry = expression('({ nodes: $$nodes, update($$next) {}, dispose() {} })', {
    nodes: b.ArrayExpression({ elements: roots.map((root) => b.Identifier({ name: root })) }),
    next,
  });
  if (entry.type !== 'ObjectExpression') {
    return entry;
  }

  for (const property of entry.properties) {
    if (property.type !== 'Property'
      || property.key.type !== 'Identifier'
      || property.value.type !== 'FunctionExpression') {
      continue;
    }
    property.value.body!.body = [...(property.key.name === 'update' ? update : dispose)];
  }
  return entry;
}

function programDeclaration(program: string, values: string, owner: string, body: Statement[]): Statement {
  const declaration = statement('const $$program = { mount($$values, $$owner) {} };', {
    program,
    values,
    owner,
  });
  if (declaration.type !== 'VariableDeclaration') {
    return declaration;
  }

  const object = declaration.declarations[0]!.init;
  if (object?.type !== 'ObjectExpression') {
    return declaration;
  }

  const mount = object.properties[0]!;
  if (mount.type === 'Property' && mount.value.type === 'FunctionExpression') {
    mount.value.body!.body = body;
  }
  return declaration;
}
