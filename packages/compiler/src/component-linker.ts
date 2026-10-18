/**
 * component-linker.ts - graph-level component placement and row-mode linking.
 *
 * Component factories are analyzed in their defining module but receive
 * runtime ids from callers. This pass turns cross-module call edges into the
 * concrete/wildcard paths used by defining-module access-table emission.
 */

import type {
  LinkedComponentPropSource,
  LinkedComponentRowUse,
} from './context';
import type {
  ComponentPropSourceRefs,
} from './components/prop-origins';
import { linkComponentPropSources } from './components/prop-linker';

export interface ComponentGraphEdge {
  target: string;
  suffix: string;
  mode: 'static' | 'row';
  /** Conditional and list-contained placements can stop a recursive cycle. */
  bounded?: true;
  keyPath?: string[] | null;
  sourceKey?: string;
  sourceLocal?: boolean;
  propSources?: ComponentPropSourceRefs;
}

export interface ComponentGraphNode {
  key: string;
  moduleId: string;
  local: string;
  edges: ComponentGraphEdge[];
}

export interface ApplicationRootPlacement {
  key: string;
  rootId: string;
}

export interface LinkedComponentGraph {
  paths: Map<string, string[]>;
  rows: Map<string, LinkedComponentRowUse[]>;
  propSources: Map<string, Map<string, LinkedComponentPropSource>>;
  /** Components placed both as keyed rows and as static children: they keep the entity ABI. */
  mixed: Set<string>;
}

/**
 * Group recursive placements (Tarjan). Only components in a cycle are
 * returned; each maps to the shared member set of its cycle.
 */
function recursiveCycles(
  nodes: Map<string, ComponentGraphNode>,
): Map<string, ReadonlySet<string>> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles = new Map<string, ReadonlySet<string>>();
  let next = 0;

  const connect = (key: string): void => {
    index.set(key, next);
    low.set(key, next);
    next++;
    stack.push(key);
    onStack.add(key);
    for (const edge of nodes.get(key)?.edges ?? []) {
      if (!nodes.has(edge.target)) continue;
      if (!index.has(edge.target)) {
        connect(edge.target);
        low.set(key, Math.min(low.get(key)!, low.get(edge.target)!));
      } else if (onStack.has(edge.target)) {
        low.set(key, Math.min(low.get(key)!, index.get(edge.target)!));
      }
    }
    if (low.get(key) !== index.get(key)) return;
    const members = new Set<string>();
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      members.add(member);
    } while (member !== key);
    const selfPlaced = nodes.get(key)?.edges.some(edge => edge.target === key) === true;
    if (members.size > 1 || selfPlaced) {
      // Only a list row or a condition can end the recursion at runtime.
      const terminates = [...members].some(member =>
        nodes.get(member)!.edges.some(edge => members.has(edge.target) &&
          (edge.mode === 'row' || edge.bounded === true)));
      if (!terminates) {
        throw new Error(
          `memo-dom: recursive cross-module component graph at '${key}' renders itself unconditionally — recurse through a list (items.map(...)) or a condition`,
        );
      }
      for (const each of members) cycles.set(each, members);
    }
  };

  for (const key of nodes.keys()) if (!index.has(key)) connect(key);
  return cycles;
}

/** Compute every declaration's caller-derived paths and keyed-row metadata. */
export function linkComponentGraph(
  declarations: readonly ComponentGraphNode[],
  applicationRoot?: ApplicationRootPlacement,
): LinkedComponentGraph {
  const nodes = new Map(declarations.map((decl) => [decl.key, decl]));
  const cycles = recursiveCycles(nodes);

  const incoming = new Map<string, Set<'static' | 'row'>>();
  const rows = new Map<string, LinkedComponentRowUse[]>();
  for (const node of nodes.values()) {
    for (const edge of node.edges) {
      if (!nodes.has(edge.target)) {
        throw new Error(
          `memo-dom: component '${node.key}' references unknown factory '${edge.target}'`,
        );
      }
      const modes = incoming.get(edge.target) ?? new Set();
      modes.add(edge.mode);
      incoming.set(edge.target, modes);
      if (edge.mode === 'row') {
        const uses = rows.get(edge.target) ?? [];
        uses.push({
          keyPath: edge.keyPath === undefined || edge.keyPath === null
            ? null
            : [...edge.keyPath],
          sourceKey: edge.sourceKey ?? '',
          sourceLocal: edge.sourceLocal ?? false,
        });
        rows.set(edge.target, uses);
      }
    }
  }

  // A component placed both as a keyed row and as a static child (an
  // `<Author>` in a feed row and on an article page) is resolvable: its paths
  // carry both placements. It keeps the full entity ABI, which both the row
  // region and an ordinary call can mount; a recursive component is one case.
  const mixed = new Set([...incoming].filter(([, modes]) => modes.size > 1).map(([key]) => key));

  const pathSets = new Map<string, Set<string>>();
  const inferredRoots = [...nodes.keys()].filter((key) =>
    !incoming.has(key) || (cycles.has(key) &&
      [...nodes.values()].every(node => !node.edges.some(edge =>
        edge.target === key && !cycles.get(key)!.has(node.key)))));
  const roots = applicationRoot === undefined
    ? inferredRoots
    : [applicationRoot.key];
  if (applicationRoot !== undefined && !nodes.has(applicationRoot.key)) {
    throw new Error(
      `memo-dom: mounted component '${applicationRoot.key}' is missing from the linked component graph`,
    );
  }
  const pending: string[] = [];
  const place = (key: string, path: string): void => {
    const add = (target: string, value: string): void => {
      const targetPaths = pathSets.get(target) ?? new Set<string>();
      if (targetPaths.has(value)) return;
      targetPaths.add(value);
      pathSets.set(target, targetPaths);
      pending.push(target);
    };
    add(key, path);
    // Entering a cycle: every member can sit at any depth below this entry.
    for (const member of cycles.get(key) ?? []) add(member, `${path}/**`);
  };
  for (const key of roots) place(key, applicationRoot?.rootId ?? 'App');

  while (pending.length > 0) {
    const key = pending.shift()!;
    const parentPaths = pathSets.get(key);
    if (parentPaths === undefined) continue;
    const cycle = cycles.get(key);
    for (const edge of nodes.get(key)?.edges ?? []) {
      // Edges inside a cycle are covered by the members' `/**` paths.
      if (cycle?.has(edge.target) === true) continue;
      for (const parentPath of [...parentPaths]) {
        place(edge.target, `${parentPath}${edge.suffix}`);
      }
    }
  }

  const paths = new Map<string, string[]>();
  for (const key of nodes.keys()) {
    paths.set(key, [...(pathSets.get(key) ?? [])].sort());
  }

  const propSources = linkComponentPropSources(nodes, roots);
  return { paths, rows, propSources, mixed };
}
