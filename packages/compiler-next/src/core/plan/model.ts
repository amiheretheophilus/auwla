/**
 * The render plan (`wiki/compiler/core.md`, "plan"): what each component builds
 * and which spots in it change. Emit reads only this and the graph.
 */
import type { Expression, Node, Statement, VariableDeclaration, VariableDeclarator } from 'yuku-parser';
import type { ResolvedModule } from '../resolve';
import type { FunctionNode } from '../resolve/functions';
import type { BindingNode } from '../graph';

/** One node of a template, in the creation order `materializeMarkup` returns (post-order). */
export type TemplateNode =
  | { readonly kind: 'element'; readonly tag: string; readonly namespace: 'html' | 'svg'; readonly attributes: readonly StaticAttribute[]; readonly children: readonly number[] }
  | { readonly kind: 'text'; readonly text: string }
  /** Where a dynamic text goes; replaced by a text node at mount. */
  | { readonly kind: 'placeholder' };

export interface StaticAttribute {
  readonly name: string;
  /** `''` for a valueless attribute. */
  readonly value: string;
}

export interface Template {
  /** Indexed by creation order; children before their parent. */
  readonly nodes: readonly TemplateNode[];
  /** Top-level nodes, in document order. */
  readonly roots: readonly number[];
  /**
   * The HTML for `materializeMarkup`, or null when the HTML parser would build a
   * different tree (`jsx.ts`, `parsesAsWritten`): then emit creates the nodes.
   */
  readonly markup: string | null;
}

/** A spot that shows a value. `reactive` sites are written again by `_update`. */
interface SiteBase {
  /** The template node it writes. */
  readonly node: number;
  /** The authored expression; emit copies it, never edits it. */
  readonly expression: Expression;
  readonly reactive: boolean;
}

export interface TextSite extends SiteBase { readonly kind: 'text' }
export interface AttributeSite extends SiteBase { readonly kind: 'attribute'; readonly name: string }
export interface PropertySite extends SiteBase { readonly kind: 'property'; readonly name: string }
export interface EventSite extends SiteBase { readonly kind: 'event'; readonly event: string }

export type Site = TextSite | AttributeSite | PropertySite | EventSite;

/** Distribute over the union so each site's own fields are retained. */
export type UnplacedSite = Site extends infer S ? S extends Site ? Omit<S, 'node'> : never : never;

export interface ComponentPlan {
  readonly fn: FunctionNode;
  /** The authored statements before the returned markup, run once as setup. */
  readonly setup: readonly Statement[];
  readonly template: Template;
  readonly sites: readonly Site[];
  readonly state: readonly BindingNode[];
  readonly writes: readonly WritePlan[];
  readonly replayWrites: readonly WritePlan[];
  readonly mutations: readonly MutationPlan[];
  readonly replayMutations: readonly MutationPlan[];
  readonly readonlyBindings: readonly BindingNode[];
  readonly takeovers: readonly BindingNode[];
  /** Directly visible inputs, keyed by the original expression's identity. */
  readonly siteInputs: ReadonlyMap<Expression, readonly BindingNode[]>;
  readonly memos: readonly MemoGroupPlan[];
  readonly trackedReads: readonly { readonly node: Node; readonly binding: BindingNode }[];
  readonly dynamicSites: ReadonlySet<Expression>;
  readonly mutationRoots: readonly BindingNode[];
}

/** Statements shared by computations run once; their outputs reset together. */
export interface MemoGroupPlan {
  readonly dynamic: boolean;
  readonly computations: readonly MemoPlan[];
  readonly inputs: readonly BindingNode[];
  readonly upstream: readonly { readonly group: number; readonly binding: BindingNode }[];
  readonly steps: readonly (Statement | VariableDeclarator)[];
  readonly outputs: ReadonlyMap<Node, readonly BindingNode[]>;
  readonly possibleOutputs: ReadonlyMap<Node, readonly BindingNode[]>;
}

/** One native declaration/pattern and the statements that build its values. */
export interface MemoPlan {
  readonly intrinsic: boolean;
  readonly declaration: VariableDeclaration;
  readonly declarator: VariableDeclarator;
  readonly targets: readonly BindingNode[];
  readonly inputs: readonly BindingNode[];
  readonly builders: readonly (Statement | VariableDeclarator)[];
  readonly builderTargets: ReadonlyMap<Node, readonly BindingNode[]>;
  readonly possibleBuilders: ReadonlyMap<Node, readonly BindingNode[]>;
}

export interface WritePlan {
  readonly operation: Node;
  readonly targets: readonly BindingNode[];
}

export interface MutationPlan {
  readonly operation: Node;
  readonly targets: readonly { readonly binding: BindingNode; readonly member: Node }[];
  readonly kind: 'store' | 'delete' | 'call';
}

export interface ModulePlan {
  readonly module: ResolvedModule;
  readonly components: ReadonlyMap<Node, ComponentPlan>;
}
