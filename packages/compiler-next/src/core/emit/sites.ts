/** Initial site values and version-guarded updates, in authored evaluation order. */
import type { Node, Statement } from 'yuku-parser';
import type { BindingNode } from '../graph';
import type { ComponentPlan, Site } from '../plan';
import { copy } from './copy';
import type { Names } from './names';
import { statement, statements, stringLiteral } from './quote';

export interface SitesEmit {
  readonly mount: readonly Statement[];
  readonly update: readonly Statement[];
}

export function emitSites(
  plan: ComponentPlan,
  context: {
    names: Names;
    runtime: string;
    batch: string | null;
    entity: string;
    versions: ReadonlyMap<BindingNode, string>;
    replacements: ReadonlyMap<Node, Node>;
    ref(index: number): string;
  },
): SitesEmit {
  const { names, runtime, batch, versions, replacements, entity } = context;
  const mount: Statement[] = [];
  const update: Statement[] = [];
  const last = new Map<string, Site>();
  for (const site of plan.sites) last.set(siteKey(site), site);

  for (const site of plan.sites) {
    const node = context.ref(site.node);
    const value = names.fresh('_value');
    const expression = copy(site.expression, replacements);
    const computation = plan.dynamicSites.has(site.expression) ? names.fresh('_siteComputation') : null;
    if (computation !== null) {
      mount.push(statement('const $$computation = $$runtime.createComputation($$batch.mark, $$entity);', { computation, runtime, batch: batch!, entity }));
      mount.push(statement('$$computation.begin();', { computation }));
    }
    mount.push(statement('let $$value = $$expression;', { value, expression }));
    if (computation !== null) mount.push(statement('$$computation.end();', { computation }));
    const used = last.get(siteKey(site)) === site;
    const listener = used && site.kind === 'event' ? names.fresh('_listener') : null;
    if (listener !== null) mount.push(statement('let $$listener;', { listener }));
    if (used) mount.push(...writeValue(site, value, node, runtime, batch, listener));

    const inputs = new Set<string>();
    for (const binding of plan.siteInputs.get(site.expression) ?? []) {
      const version = versions.get(binding);
      if (version !== undefined) inputs.add(version);
    }
    if (inputs.size === 0 && computation === null) continue;

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
    const writes = used ? writeValue(site, next, node, runtime, batch, listener) : [];
    writes.push(statement('$$value = $$next;', { value, next }));
    // Equality also keeps an unchanged prop from replacing text a user typed.
    // The NaN check avoids relying on an authored binding named Object.
    const changed = statement(`if (${next} !== ${value} && !(${next} !== ${next} && ${value} !== ${value})) {}`);
    if (changed.type === 'IfStatement' && changed.consequent.type === 'BlockStatement') {
      changed.consequent.body = writes;
    }
    body.push(changed);
    for (const { version, seen } of snapshots) body.push(statement('$$seen = $$version;', { seen, version }));
    const conditions = snapshots.map(({ version, seen }) => `${version} !== ${seen}`);
    if (computation !== null) conditions.push(`${computation}.changed()`);
    const guard = statement(`if (${conditions.join(' || ')}) {}`);
    if (guard.type === 'IfStatement' && guard.consequent.type === 'BlockStatement') guard.consequent.body = body;
    update.push(guard);
  }
  return { mount, update };
}

function siteKey(site: Site): string {
  if (site.kind === 'text') return `${site.node}:text`;
  if (site.kind === 'event') return `${site.node}:event:${site.event}`;
  return `${site.node}:${site.kind}:${site.name}`;
}

function writeValue(
  site: Site, value: string, node: string, runtime: string, batch: string | null, listener: string | null,
): Statement[] {
  if (site.kind === 'text') {
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
  const wrapped = batch === null ? value : `${batch}.listener(${value})`;
  return statements(`
    if (${listener} !== undefined) $$node.removeEventListener($$event, ${listener});
    ${listener} = undefined;
    if (typeof $$value === "function") {
      ${listener} = ${wrapped};
      $$node.addEventListener($$event, ${listener});
    }`, { node, value, event: stringLiteral(site.event) });
}
