/** Optimize private row lookup without making assumptions about authored calls. */
import type { ModulePlan, Site } from '../core/plan';
import type { Optimization } from '.';

function indexedSites(sites: readonly Site[]): readonly Site[] {
  let changed = false;
  const next = sites.map((site): Site => {
    if (site.kind === 'text' && !site.primitive && site.listStrategy === undefined) {
      changed = true;
      return { ...site, listStrategy: 'retained-index' };
    }
    if (site.kind !== 'conditional') {
      return site;
    }

    const branches = site.branches.map((branch) => {
      const nested = indexedSites(branch.sites);
      if (nested === branch.sites) {
        return branch;
      }
      changed = true;
      return { ...branch, sites: nested };
    });
    return branches.some((branch, index) => branch !== site.branches[index])
      ? { ...site, branches }
      : site;
  });
  return changed ? next : sites;
}

export const retainedListIndex: Optimization = {
  name: 'retained-list-index',
  match(general: ModulePlan): ModulePlan | null {
    // Any non-primitive child can receive an array. Its runtime rows have
    // immutable renderer-owned identities, so indexing them does not need a
    // method, callback or tag-name proof. Values and effects still run normally.
    let changed = false;
    const components = new Map(general.components);
    for (const [fn, component] of general.components) {
      const sites = indexedSites(component.sites);
      if (sites === component.sites) {
        continue;
      }
      changed = true;
      components.set(fn, { ...component, sites });
    }
    const values = general.values.map((value) => {
      const sites = indexedSites(value.sites);
      if (sites === value.sites) {
        return value;
      }
      changed = true;
      return { ...value, sites };
    });
    return changed ? { ...general, components, values } : null;
  },
};
