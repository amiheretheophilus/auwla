/** Initial site values and version-guarded updates, in authored evaluation order. */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../graph';
import type { ComponentPlan, Site } from '../plan';
import type { ConditionalBranch } from '../plan/model';
import { copy } from './copy';
import type { Names } from './names';
import { expression as buildExpression, statement, statements, stringLiteral } from './quote';
import { emitSelection, type EmitOnce } from '../../features/conditionals/dom';
import { emitNodes } from './template';
import { siteValue } from './render-value';
import { emitRowList, type RowComponents } from './row-list';

export interface SitesEmit {
  readonly mount: readonly Statement[];
  readonly update: readonly Statement[];
  readonly dispose: readonly Statement[];
}
export type SitesPlan = Pick<ComponentPlan, 'sites' | 'siteInputs' | 'dynamicSites'>;

export interface SitesContext {
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
  /**
   * A row of a row list (`row-list.ts`): every update evaluates each site
   * again, except a handler written as a function literal, created once; it
   * reads the row's parameters, which the update assigns.
   */
  rows?: boolean;
  /** Leaf component rows compiled at module level (`row-list.ts`). */
  rowComponents?: RowComponents;
  /** Ownership reconciled alongside a component's early-return selector. */
  select?(site: Site, value: Expression): Expression;
}

export function emitSites(
  plan: SitesPlan,
  context: SitesContext,
): SitesEmit {
  const { names, runtime, batch, versions, replacements, entity } = context;
  // Captured programs and rows evaluate every site on each update.
  const replays = context.values !== undefined || context.rows === true;
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
    if (site.kind === 'ref') {
      // Refs mount once with the element and leave with that exact branch/row.
      // A new wrapper on an unrelated render must not remount a callback ref.
      const cleanup = names.fresh('_releaseRef');
      const ref = context.values === undefined ? copy(site.expression, replacements)
        : buildExpression('$$values[$$index]', { values: context.values, index: b.Literal({ value: siteIndex, raw: String(siteIndex) }) });
      mount.push(statement('const $$cleanup = $$runtime.ownCleanup($$owner, $$runtime.mountRef($$node, $$ref));', {
        cleanup, runtime, node, ref,
        owner: context.batch === null ? buildExpression('$$id', { id: context.id })
          : buildExpression('$$entity?.id ?? $$id', { entity: context.entity, id: context.id }),
      }));
      dispose.push(statement('$$cleanup();', { cleanup }));
      continue;
    }
    const value = names.fresh('_value');
    // The row list exists before the site's `map` call passes it to the runtime.
    const rowList = site.kind === 'text' && site.listStrategy === 'rows' && site.rows !== undefined
      ? emitRowList(site.rows, node, context)
      : null;
    if (rowList !== null) {
      mount.push(...rowList.declarations);
      dispose.push(statement('$$list.dispose();', { list: rowList.list }));
    }
    const selection = site.kind === 'conditional'
      ? emitSelection(site.selection, { names, runtime, replacements, versions, once: context.once })
      : null;
    if (selection !== null) {
      mount.push(...selection.declarations);
    }

    let expression: Expression;
    if (context.values === undefined) {
      expression = selection?.expression ?? copy(siteValue(site), replacements);
      if (selection !== null && context.select !== undefined) expression = context.select(site, expression);
    } else {
      // A stored JSX program receives captures; mounting it must not evaluate
      // its authored expressions a second time.
      expression = buildExpression('$$values[$$index]', {
        values: context.values,
        index: b.Literal({ value: siteIndex, raw: String(siteIndex) }),
      });
    }

    const routed = rowList !== null && site.kind === 'text' && site.rows!.routes.length > 0;
    const needsCollector = context.values === undefined && (plan.dynamicSites.has(site.expression) || routed);
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
    let valueSlot: LazySlot | null = null;
    if (site.kind === 'text' && !site.primitive && rowList === null) {
      // Most such sites only ever show text. The slot, which also shows stored
      // JSX and arrays, is created by the first value that is an object.
      const slot = names.fresh('_valueSlot');
      const factory = site.listStrategy === 'retained-index' ? 'createIndexedValueSlot' : 'createValueSlot';
      valueSlot = {
        name: slot,
        create: buildExpression(`$$runtime.${factory}($$text, $$owner)`, { runtime, text: node, owner: renderOwner(context) }),
      };
      mount.push(statement('let $$slot = null;', { slot }));
      dispose.push(statement('if ($$slot !== null) $$slot.dispose();', { slot }));
      dispose.push(statement('$$slot = $$runtime.disposedValueSlot;', { slot, runtime }));
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
      mount.push(...writeValue(site, value, node, runtime, batch, listener, valueSlot, rowList?.list ?? null));
    }
    if (context.rows === true && site.kind === 'event' && isFunctionLiteral(site.expression)) {
      // Evaluating it again would create the same function over the same row
      // bindings; only its identity, which no authored code sees, would differ.
      continue;
    }

    const inputs = new Set<string>();
    const bindings = context.values === undefined ? plan.siteInputs.get(site.expression) ?? [] : [];
    for (const binding of bindings) {
      const version = versions.get(binding);
      if (version !== undefined) {
        inputs.add(version);
      }
    }
    if (inputs.size === 0 && computation === null && !replays) {
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
    const writes = used ? writeValue(site, next, node, runtime, batch, listener, valueSlot, rowList?.list ?? null) : [];
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
    if (routed) conditions.push(`${rowList.list}.changed()`);
    if (replays) {
      update.push(...body);
    } else {
      update.push(guardedStatements(buildExpression(conditions.join(' || ')), body));
    }
    if (routed) update.push(statement('$$list.refresh($$computation);', { list: rowList.list, computation: computation! }));

    // The selector's inputs can be unchanged while an active branch's own text
    // changed. Always reach that branch; its sites apply their own guards.
    if (region !== null) {
      update.push(statement('$$region.update();', { region }));
    }
  }
  return { mount, update, dispose };
}

/** What nested slots and lists need from the component that owns them. */
export function renderOwner(context: SitesContext): Expression {
  const batch = context.batch;
  return buildExpression('({ id: $$id, batch: $$batch, entity: $$entity, namespace: $$namespace })', {
    id: context.id,
    batch: batch ?? buildExpression('null'),
    entity: batch === null ? buildExpression('void 0') : context.entity,
    namespace: context.namespace ?? buildExpression('void 0'),
  });
}

function isFunctionLiteral(node: Node): boolean {
  while (is.ParenthesizedExpression(node)) node = node.expression;
  return is.ArrowFunctionExpression(node) || is.FunctionExpression(node);
}

/** A text site's value slot, created on the first value that is an object. */
interface LazySlot {
  readonly name: string;
  readonly create: Expression;
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
    const templateContext = { names, runtime, document, markup, namespace: context.namespace };
    const slots = emitNodes(branch.template, branch.sites, templateContext);
    const sites = emitSites({ ...plan, sites: branch.sites }, { ...context, ref: slots.ref });
    roots = branch.template.roots.map(slots.root);
    const declarations = markup === null ? [] : [
      statement('const $$markup = $$html;', { markup, html: stringLiteral(branch.template.markup!) }),
    ];
    body = [
      ...declarations,
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
  if (site.kind === 'text' || site.kind === 'conditional' || site.kind === 'key' || site.kind === 'ref') {
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
  valueSlot: LazySlot | null,
  rowList: string | null,
): Statement[] {
  if (site.kind === 'conditional' || site.kind === 'key' || site.kind === 'ref') {
    return [];
  }
  if (site.kind === 'text') {
    if (rowList !== null) {
      // The list already showed its rows inside `map`; other values fall back to a slot.
      return [statement('$$list.write($$value);', { list: rowList, value })];
    }
    if (valueSlot !== null) {
      // Before a slot exists, a value that is not an object is text, exactly
      // what a new slot would write (`render-value.ts`, `write`).
      return statements(`
        if (${valueSlot.name} === null && ($$value === null || typeof $$value !== "object")) {
          $$runtime.setTextData($$node, $$value);
        } else {
          (${valueSlot.name} ??= $$create).write($$value);
        }`, { runtime, node, value, create: valueSlot.create });
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
