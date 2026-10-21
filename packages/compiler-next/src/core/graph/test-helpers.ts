/** Real source fixtures shared by feature tests; assertions never manufacture classifications. */
import { parseModule } from '../parse';
import { resolve } from '../resolve';
import { classifyGraph } from './classify';
import type { BindingNode } from './model';

export function inspect(source: string, modules: Record<string, string> = {}) {
  const files = { './App.tsx': source, ...modules };
  const parsed = Object.entries(files).map(([path, text]) => parseModule(path, text));
  const resolved = resolve(parsed, {});
  const before = resolved.modules.map((entry) => JSON.stringify(entry.module.ast));
  const graph = classifyGraph(resolved);

  function node(name: string, path = './App.tsx', occurrence = 0): BindingNode {
    const matches = [...graph.bindings.values()].filter((entry) => {
      return entry.binding.name === name && entry.binding.module.path === path;
    });
    const found = matches[occurrence];
    if (found === undefined) throw new Error(`missing test binding ${path}:${name}:${occurrence}`);
    return found;
  }
  function reads(name: string, path = './App.tsx'): string[] {
    return [...new Set(node(name, path).reads.map((edge) => {
      return edge.target.binding?.name ?? ('reference' in edge.target ? edge.target.reference.name : '');
    }))].sort();
  }
  return { graph, node, reads, before };
}
