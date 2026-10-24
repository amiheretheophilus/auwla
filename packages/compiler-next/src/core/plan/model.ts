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
  | {
    readonly kind: 'element';
    readonly tag: string;
    readonly namespace: 'html' | 'svg';
    readonly attributes: readonly StaticAttribute[];
    readonly children: readonly number[];
  }
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

export interface TextSite extends SiteBase {
  readonly kind: 'text';
  /**
   * The expression can only produce a primitive, so the site writes its text
   * node directly. Otherwise a value slot also accepts stored JSX and arrays.
   */
  readonly primitive: boolean;
  /** `{...items}`: each item is a child, so the site shows `[...items]`. */
  readonly spread?: boolean;
}

export interface AttributeSite extends SiteBase {
  readonly kind: 'attribute';
  readonly name: string;
}

export interface PropertySite extends SiteBase {
  readonly kind: 'property';
  readonly name: string;
}

export interface EventSite extends SiteBase {
  readonly kind: 'event';
  readonly event: string;
}

export interface ConditionalSite extends SiteBase {
  readonly kind: 'conditional';
  readonly namespace: 'html' | 'svg';
  readonly selection: ConditionalSelection;
  readonly branches: readonly ConditionalBranch[];
  readonly selectorInputs: readonly Expression[];
}

export type ConditionalSelection =
  | {
    readonly kind: 'branch';
    readonly index: number;
    readonly value: Expression | null;
  }
  | {
    readonly kind: 'test';
    readonly test: Expression;
    readonly consequent: ConditionalSelection;
    readonly alternate: ConditionalSelection;
  }
  | {
    readonly kind: 'logical';
    readonly operator: '&&' | '||' | '??';
    readonly left: Expression;
    readonly right: ConditionalSelection;
    readonly fallback: number;
  }
  | {
    /**
     * A component tail whose returns interleave with setup statements, or sit
     * in a `switch` or a loop. It runs as a native function that returns a
     * branch choice (`conditionals-and-lists.md`, "Early returns").
     */
    readonly kind: 'program';
    readonly steps: readonly ProgramStep[];
    /** Each authored `return` of the component, and what its argument selects. */
    readonly returns: ReadonlyMap<Node, ConditionalSelection>;
    /** Chosen when control reaches the end of the component; null when it cannot. */
    readonly fallthrough: number | null;
    /**
     * `var` declarations inside the native statements. They belong to the
     * component's scope, not the selector's, so later returns and handlers see them.
     */
    readonly functionScoped: readonly FunctionScoped[];
  };

/** A `var` declaration inside a selector program, and where it sits. */
export interface FunctionScoped {
  readonly declaration: Extract<Node, { type: 'VariableDeclaration' }>;
  /** A statement, a `for` loop's init, or a `for…in`/`for…of` left side. */
  readonly position: 'statement' | 'for-init' | 'for-left';
}

export type ProgramStep =
  /** Top-level statements that run once, the first time control reaches them. */
  | { readonly kind: 'once'; readonly statements: readonly Statement[] }
  /**
   * A statement containing a return. It runs again on every selection, except
   * its `guards` (`wiki/decisions.md`, 2026-10-24).
   */
  | { readonly kind: 'native'; readonly statement: Statement; readonly guards: readonly ReturningGuard[] };

/**
 * A plain statement inside a block that returns. It runs when reached and its
 * inputs changed since it last ran, or when it was not reached on the previous
 * run. Opaque inputs cannot be compared, so such a statement always runs.
 */
export interface ReturningGuard {
  readonly statement: Statement;
  readonly inputs: readonly BindingNode[];
  readonly opaque: boolean;
}

export interface ConditionalBranch {
  /** Null for a selected primitive; its value comes from the selector. */
  readonly template: Template | null;
  readonly sites: readonly Site[];
}

export type Site = TextSite | AttributeSite | PropertySite | EventSite | ConditionalSite;

/** Distribute over the union so each site's own fields are retained. */
export type UnplacedSite = Site extends infer S ? S extends Site ? Omit<S, 'node'> : never : never;

export interface ComponentPlan {
  readonly fn: FunctionNode;
  /**
   * The authored statements that run once as setup: those before the first
   * return, then the top-level ones between returns. Those in `deferred` run
   * when control first reaches them, inside the selector.
   */
  readonly setup: readonly Statement[];
  /** Setup statements after the first return, each with its segment's index. */
  readonly deferred: ReadonlyMap<Statement, number>;
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
  /**
   * A `var` declared inside one of its builders (`for (var i = 0; …)`). The
   * builder declares it again on every replay, so the declarator is no step.
   */
  readonly nested: boolean;
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
  readonly sharedOwners: readonly SharedOwnerPlan[];
  readonly sharedReads: ReadonlyMap<BindingNode, SharedReadPlan>;
  readonly receiverTargets: readonly Node[];
  readonly values: readonly RenderValuePlan[];
}

export interface RenderValuePlan {
  /** Identity of the JSX creation expression, shared across its consumers. */
  readonly node: Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>;
  readonly template: Template;
  readonly svgTemplate: Template;
  /** Source order is also the capture-array order used by the emitted program. */
  readonly sites: readonly Site[];
  /** The root element's `key`, captured with the value; a list matches rows by it. */
  readonly key: Expression | null;
}

export interface SharedReadPlan {
  readonly binding: BindingNode;
  readonly name: string;
  readonly path: string;
}

export interface SharedOwnerPlan {
  readonly fn: FunctionNode | null;
  /** A nested lexical activation; null for a whole function/module. */
  readonly block: Extract<Node, { type: 'BlockStatement' }> | null;
  readonly state: readonly BindingNode[];
  readonly setup: readonly Statement[];
  readonly memos: readonly MemoGroupPlan[];
  readonly writes: readonly WritePlan[];
  readonly mutations: readonly MutationPlan[];
  readonly replayWrites: readonly WritePlan[];
  readonly replayMutations: readonly MutationPlan[];
  readonly readonlyBindings: readonly BindingNode[];
  readonly takeovers: readonly BindingNode[];
}
