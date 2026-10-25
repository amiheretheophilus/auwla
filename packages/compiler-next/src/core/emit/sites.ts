/** Initial site values and version-guarded updates, in authored evaluation order. */
import { b } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../graph';
import type { ComponentPlan, Site } from '../plan';
import type { ConditionalBranch } from '../plan/model';
import { copy } from './copy';
import type { Names } from './names';
import { expression as buildExpression, statement, statements, stringLiteral } from './quote';
import { emitSelection, type EmitOnce } from '../../features/conditionals/dom';
import { emitTemplate, prepareTemplateSites } from './template';
import { siteValue } from './render-value';

export interface SitesEmit {
  readonly mount: readonly Statement[];
  readonly update: readonly Statement[];
  readonly dispose: readonly Statement[];
}
export type SitesPlan = Pick<ComponentPlan, 'sites' | 'siteInputs' | 'dynamicSites'>;

interface SitesContext {
  names: Names;
  runtime: string;
  batch: string | null;
  entity: string;
  id: string;
  document: string;
  /** Stored JSX already evaluated its inputs at the authored creation site. */
  values?: string;
  namespace?: string | Expression;
  versions: ReadonlyMap<BindingNode, string>;
  replacements: ReadonlyMap<Node, Node>;
  ref(index: number): string;
  /** Deferred setup inside a component's selector program. */
  once?: EmitOnce;
}

export function emitSites(
  plan: SitesPlan,
  context: SitesContext,
): SitesEmit {
  const { names, runtime, batch, versions, replacements, entity } = context;
  const mount: Statement[] = [];
  const update: Statement[] = [];
  const dispose: Statement[] = [];
  // Duplicate attributes still evaluate in source order, but only their last
  // value reaches the DOM. Discarding earlier expressions would lose effects.
  const lastSiteByKey = new Map<string, Site>();
  for (const site of plan.sites) {
    lastSiteByKey.set(siteKey(site), site);
  }

  for (const [siteIndex, site] of plan.sites.entries()) {
    if (site.kind === 'key' && context.values !== undefined) {
      // Captured keys already ran at creation; row matching consumes the final
      // root key. A DOM program has no attribute or child to update for them.
      continue;
    }
    const node = context.ref(site.node);
    const value = names.fresh('_value');
    const selection = site.kind === 'conditional'
      ? emitSelection(site.selection, { names, runtime, replacements, versions, once: context.once })
      : null;
    if (selection !== null) {
      mount.push(...selection.declarations);
    }

    let expression: Expression;
    if (context.values === undefined) {
      expression = selection?.expression ?? copy(siteValue(site), replacements);
    } else {
      // A stored JSX program receives captures; mounting it must not evaluate
      // its authored expressions a second time.
      expression = buildExpression('$$values[$$index]', {
        values: context.values,
        index: b.Literal({ value: siteIndex, raw: String(siteIndex) }),
      });
    }

    const needsCollector = context.values === undefined && plan.dynamicSites.has(site.expression);
    const computation = needsCollector ? names.fresh('_siteComputation') : null;
    if (computation !== null) {
      mount.push(statement('const $$computation = $$runtime.createComputation($$batch.mark, $$entity);', {
        computation, runtime, batch: batch!, entity,
      }));
      mount.push(statement('$$computation.begin();', { computation }));
      dispose.push(statement('$$computation.dispose();', { computation }));
    }
    mount.push(statement('let $$value = $$expression;', { value, expression }));
    if (computation !== null) {
      mount.push(statement('$$computation.end();', { computation }));
    }
    const used = site.kind !== 'key' && lastSiteByKey.get(siteKey(site)) === site;
    const listener = used && site.kind === 'event' ? names.fresh('_listener') : null;
    if (listener !== null) {
      mount.push(statement('let $$listener;', { listener }));
    }
    let region: string | null = null;
    let valueSlot: string | null = null;
    if (site.kind === 'text' && !site.primitive) {
      valueSlot = names.fresh('_valueSlot');
      const factory = site.listStrategy === 'retained-index' ? 'createIndexedValueSlot' : 'createValueSlot';
      mount.push(statement(`const $$slot = $$runtime.${factory}($$text, { id: $$id, batch: $$batch, entity: $$entity, namespace: $$namespace });`, {
        slot: valueSlot,
        runtime,
        text: node,
        id: context.id,
        batch: batch ?? buildExpression('null'),
        entity: batch === null ? buildExpression('void 0') : entity,
        namespace: context.namespace ?? buildExpression('void 0'),
      }));
      dispose.push(statement('$$slot.dispose();', { slot: valueSlot }));
    }
    if (site.kind === 'conditional') {
      region = names.fresh('_conditional');
      const namespace = names.fresh('_branchNamespace');
      mount.push(statement('const $$namespace = $$runtime.renderNamespace($$slot.parentNode, $$inherited);', {
        namespace, runtime, slot: node,
        inherited: context.namespace ?? stringLiteral(site.namespace),
      }));
      const branchContext = { ...context, namespace };
      const factories = site.branches.map((branch) => emitBranch(branch, value, plan, branchContext));
      mount.push(statement('const $$region = $$runtime.createCondRegion($$slot.parentNode, $$id + $$suffix, () => $$value.index, $$branches, void 0, void 0, void 0, $$slot);', {
        region,
        runtime,
        slot: node,
        id: context.id,
        suffix: stringLiteral(`:${region}`),
        value,
        branches: b.ArrayExpression({ elements: factories }),
      }));
      mount.push(statement('$$slot.remove();', { slot: node }));
      dispose.push(statement('$$region.dispose();', { region }));
    } else if (used) {
      mount.push(...writeValue(site, value, node, runtime, batch, listener, valueSlot));
    }

    const inputs = new Set<string>();
    const bindings = context.values === undefined ? plan.siteInputs.get(site.expression) ?? [] : [];
    for (const binding of bindings) {
      const version = versions.get(binding);
      if (version !== undefined) {
        inputs.add(version);
      }
    }
    if (inputs.size === 0 && computation === null && context.values === undefined) {
      if (region !== null) {
        update.push(statement('$$region.update();', { region }));
      }
      continue;
    }

    const snapshots = [...inputs].map((version) => ({ version, seen: names.fresh('_seen') }));
    for (const { version, seen } of snapshots) {
      mount.push(statement('let $$seen = $$version;', { seen, version }));
    }
    const next = names.fresh('_next');
    const body: Statement[] = [statement('const $$next = $$expression;', { next, expression })];
    if (computation !== null) {
      body.unshift(statement('$$computation.begin();', { computation }));
      body.push(statement('$$computation.end();', { computation }));
    }
    const writes = used ? writeValue(site, next, node, runtime, batch, listener, valueSlot) : [];
    writes.push(statement('$$value = $$next;', { value, next }));
    // Equality also keeps an unchanged prop from replacing text a user typed.
    // The NaN check avoids relying on an authored binding named Object.
    const changed = buildExpression(`(${next} !== ${value} && !(${next} !== ${next} && ${value} !== ${value}))`);
    body.push(guardedStatements(changed, writes));
    for (const { version, seen } of snapshots) {
      body.push(statement('$$seen = $$version;', { seen, version }));
    }
    const conditions = snapshots.map(({ version, seen }) => `${version} !== ${seen}`);
    if (computation !== null) {
      conditions.push(`${computation}.changed()`);
    }
    if (context.values !== undefined) {
      update.push(...body);
    } else {
      update.push(guardedStatements(buildExpression(conditions.join(' || ')), body));
    }

    // The selector's inputs can be unchanged while an active branch's own text
    // changed. Always reach that branch; its sites apply their own guards.
    if (region !== null) {
      update.push(statement('$$region.update();', { region }));
    }
  }
  return { mount, update, dispose };
}

function guardedStatements(test: Expression, body: Statement[]): Statement {
  return b.IfStatement({
    test,
    consequent: b.BlockStatement({ body }),
    alternate: null,
  });
}

function emitBranch(branch: ConditionalBranch, selected: string, plan: SitesPlan, context: SitesContext) {
  const { names, runtime, document } = context;
  let body: Statement[];
  let roots: string[];
  let update: readonly Statement[];
  let dispose: readonly Statement[] = [];
  if (branch.template === null) {
    const text = names.fresh('_branchText');
    const fragment = names.fresh('_branchRoot');
    const slot = names.fresh('_branchValue');
    roots = [fragment];
    body = [
      statement('const $$text = $$document.createTextNode("");', { text, document }),
      statement('const $$fragment = $$document.createDocumentFragment();', { fragment, document }),
      statement('$$fragment.appendChild($$text);', { fragment, text }),
      statement('const $$slot = $$runtime.createValueSlot($$text, { id: $$id, batch: $$batch, entity: $$entity, namespace: $$namespace });', {
        slot, runtime, text, id: context.id, batch: context.batch ?? buildExpression('null'),
        entity: context.batch === null ? buildExpression('void 0') : context.entity,
        namespace: context.namespace ?? buildExpression('void 0'),
      }),
      statement('$$slot.write($$selected.value);', { slot, selected }),
    ];
    update = [statement('$$slot.write($$selected.value);', { slot, selected })];
    dispose = [statement('$$slot.dispose();', { slot })];
  } else {
    const markup = branch.template.markup === null ? null : names.fresh('_branchMarkup');
    const used = new Set(branch.template.roots);
    for (const site of branch.sites) {
      used.add(site.node);
    }
    const templateContext = { names, runtime, document, markup, namespace: context.namespace };
    const template = emitTemplate(branch.template, used, templateContext);
    const slots = prepareTemplateSites(branch.template, branch.sites, template, templateContext);
    const sites = emitSites({ ...plan, sites: branch.sites }, { ...context, ref: slots.ref });
    roots = branch.template.roots.map(slots.root);
    const declarations = markup === null ? [] : [
      statement('const $$markup = $$html;', { markup, html: stringLiteral(branch.template.markup!) }),
    ];
    body = [
      ...declarations,
      ...template.statements,
      ...slots.statements,
      ...sites.mount,
    ];
    update = sites.update;
    dispose = sites.dispose;
  }
  const entry = buildExpression('({ nodes: $$nodes, update() {}, dispose() {} })', {
    nodes: b.ArrayExpression({ elements: roots.map((root) => b.Identifier({ name: root })) }),
  });
  if (entry.type === 'ObjectExpression') {
    for (const property of entry.properties) {
      if (property.type !== 'Property'
        || property.key.type !== 'Identifier'
        || property.value.type !== 'FunctionExpression') {
        continue;
      }
      property.value.body!.body = [...(property.key.name === 'update' ? update : dispose)];
    }
  }
  body.push(b.ReturnStatement({ argument: entry }));
  return b.ArrowFunctionExpression({
    id: null,
    params: [],
    body: b.BlockStatement({ body }),
    async: false,
    generator: false,
    expression: false,
  });
}

function siteKey(site: Site): string {
  if (site.kind === 'text' || site.kind === 'conditional' || site.kind === 'key') {
    return `${site.node}:${site.kind}`;
  }
  if (site.kind === 'event') {
    return `${site.node}:event:${site.event}`;
  }
  return `${site.node}:${site.kind}:${site.name}`;
}

function writeValue(
  site: Site,
  value: string,
  node: string,
  runtime: string,
  batch: string | null,
  listener: string | null,
  valueSlot: string | null,
): Statement[] {
  if (site.kind === 'conditional' || site.kind === 'key') {
    return [];
  }
  if (site.kind === 'text') {
    if (valueSlot !== null) {
      return [statement('$$slot.write($$value);', { slot: valueSlot, value })];
    }
    return [statement('$$runtime.setTextData($$node, $$value);', { runtime, node, value })];
  }
  if (site.kind === 'property') {
    return [statement('$$node[$$name] = $$value;', { node, value, name: stringLiteral(site.name) })];
  }
  if (site.kind === 'attribute') {
    return [statement(`if ($$value != null && $$value !== false) {
      $$node.setAttribute($$name, $$value === true ? "" : $$runtime.textValue($$value));
    } else { $$node.removeAttribute($$name); }`, { node, value, runtime, name: stringLiteral(site.name) })];
  }
  const wrapped = batch === null ? value : `${batch} === null ? ${value} : ${batch}.listener(${value})`;
  return statements(`
    if (${listener} !== undefined) $$node.removeEventListener($$event, ${listener});
    ${listener} = undefined;
    if (typeof $$value === "function") {
      ${listener} = ${wrapped};
      $$node.addEventListener($$event, ${listener});
    }`, { node, value, event: stringLiteral(site.event) });
}
