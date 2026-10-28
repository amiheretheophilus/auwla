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
   * The namespace the roots were planned in: `svg` for a branch inside
   * `<svg>`. A component or stored value planned in HTML can still follow its
   * destination (`emit/template.ts`, `inheritedNodes`).
   */
  readonly namespace: 'html' | 'svg';
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
   * Optional row bookkeeping: `retained-index` keeps evaluation general; `rows`
   * shows the site's `map` call through compiled rows (`rows`, `optimize/row-lists.ts`).
   */
  readonly listStrategy?: 'retained-index' | 'rows';
  readonly rows?: RowListPlan;
  /**
   * The expression can only produce a primitive, so the site writes its text
   * node directly. Otherwise a value slot also accepts stored JSX and arrays.
   */
  readonly primitive: boolean;
  /** An optimized former value slot must still ignore writes after its disposal. */
  readonly guardDisposal?: boolean;
  /** `{...items}`: each item is a child, so the site shows `[...items]`. */
  readonly spread?: boolean;
}

/**
 * `items.map((item, index) => <element key={…} …>)` as a text site's whole
 * value. When the runtime proves the intrinsic `map`, a row list evaluates the
 * row's sites directly per item instead of calling the callback
 * (`runtime/src/row-list.ts`); otherwise the callback runs as written.
 */
export interface RowListPlan {
  readonly call: Extract<Node, { type: 'CallExpression' }>;
  readonly callback: Extract<Node, { type: 'ArrowFunctionExpression' }>;
  /** The root's `key`, its first attribute; null without one. */
  readonly key: Expression | null;
  /**
   * `selected === row.id` in the row, where `selected` is tracked and the right
   * side is the key expression itself: the row depends on `selected` only
   * through its own key. The list refreshes the rows keyed by the old and the
   * new value instead of every row (`runtime/src/row-list.ts`, `route`).
   */
  readonly routes: readonly { readonly node: Extract<Node, { type: 'BinaryExpression' }>; readonly binding: BindingNode }[];
  readonly row:
    /** An element, planned as stored JSX. */
    | { readonly kind: 'element'; readonly value: RenderValuePlan }
    /**
     * `<Row key={…} a={…} />` for a leaf component (`optimize/row-lists.ts`):
     * its template is compiled once more as a row taking the props object.
     */
    | {
      readonly kind: 'component';
      readonly component: FunctionNode;
      /** The props after `key`, in authored order. */
      readonly props: readonly { readonly name: string; readonly value: Expression }[];
    };
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

export interface RefSite extends SiteBase {
  readonly kind: 'ref';
}

export interface RefPlan {
  readonly expression: Extract<Node, { type: 'Identifier' | 'MemberExpression' }>;
  readonly binding: BindingNode;
  readonly value: Extract<Node, { type: 'Identifier' }>;
  readonly assignment: Extract<Node, { type: 'AssignmentExpression' }>;
}

export interface LifecycleCallPlan {
  readonly call: Extract<Node, { type: 'CallExpression' }>;
  readonly kind: '$effect' | '$cleanup';
  readonly owner: FunctionNode | null;
  readonly inputs: readonly Expression[];
}

export interface EffectGroupPlan {
  readonly owner: FunctionNode | null;
  readonly root: Node;
  readonly reads: readonly { readonly node: Extract<Node, { type: 'Identifier' | 'JSXIdentifier' }>; readonly binding: BindingNode }[];
}

/** A JSX identity input: evaluated with the attributes, never written to DOM. */
export interface KeySite extends SiteBase {
  readonly kind: 'key';
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

export type Site = TextSite | AttributeSite | PropertySite | EventSite | RefSite | KeySite | ConditionalSite;

/** Distribute over the union so each site's own fields are retained. */
export type UnplacedSite = Site extends infer S ? S extends Site ? Omit<S, 'node'> : never : never;

export interface ComponentPlan {
  readonly sources?: ComponentSourcesPlan;
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
  /**
   * Optional (`optimize/keyed-comparisons.ts`): `x === e` / `x !== e` whose left
   * operand is one of `trackedReads`, emitted with `trackEquals` so a row
   * depends only on the comparison. Keyed by the BinaryExpression.
   */
  readonly keyedComparisons?: ReadonlyMap<Node, BindingNode>;
  readonly dynamicSites: ReadonlySet<Expression>;
  readonly mutationRoots: readonly BindingNode[];
}

/** Component-local sources still use native bindings and the shared memo engine. */
export interface ComponentSourcesPlan {
  readonly bindings: readonly {
    readonly binding: BindingNode;
    readonly call: Extract<Node, { type: 'CallExpression' }>;
  }[];
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
  /** Source requests replay for their request inputs, independently of payload builders. */
  readonly initializerInputs?: readonly BindingNode[];
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
  /**
   * Optional (`optimize/methods.ts`): a plain member call lowered to
   * `observeMethod`, which skips the snapshot when the runtime proves the
   * actual callee. Bit `i` of `provenCallbacks` marks argument `i` as an
   * inline function proven to make no explicit call or outside store.
   */
  readonly method?: {
    readonly provenCallbacks: number;
    /** The first argument also allows row reuse when the callee is the intrinsic `map` (`optimize/row-reuse.ts`). */
    readonly rowReuse?: { readonly usesIndex: boolean };
    /** The call is a text site's whole value, shown by a row list (`optimize/row-lists.ts`). */
    readonly rowList?: boolean;
  };
  /**
   * Optional (`optimize/helpers.ts`): a call of a helper proven to edit only
   * what it allocates, lowered to `observeHelper`, which skips the snapshot
   * once the runtime proves the array methods the proof assumed.
   */
  readonly helper?: {
    readonly copies: readonly (readonly [number, string])[];
    readonly methods: readonly string[];
    readonly primitives: readonly number[];
    readonly propertyKeys: readonly number[];
  };
}

export interface ModulePlan {
  /** Source readiness is planned from the same graph, including helper scopes. */
  readonly sourceFlow?: SourceFlowPlan;
  readonly effects: { readonly calls: readonly LifecycleCallPlan[]; readonly groups: readonly EffectGroupPlan[] };
  readonly refs: readonly RefPlan[];
  readonly module: ResolvedModule;
  readonly components: ReadonlyMap<Node, ComponentPlan>;
  readonly sharedOwners: readonly SharedOwnerPlan[];
  readonly sharedReads: ReadonlyMap<BindingNode, SharedReadPlan>;
  readonly receiverTargets: readonly Node[];
  readonly values: readonly RenderValuePlan[];
  readonly calls: readonly Extract<Node, { type: 'JSXElement' }>[];
  readonly componentReferences: ReadonlySet<Node>;
  /**
   * Optional (`optimize/keyed-comparisons.ts`): `x === e` / `x !== e` where `x`
   * is a shared binding of this module, read first, and `e` has no explicit
   * effect. Emitted with `trackEquals`, so a reader wakes only when the
   * comparison can flip. Keyed by the BinaryExpression.
   */
  readonly keyedComparisons?: ReadonlyMap<Node, BindingNode>;
  /** Comparisons whose compiled row copies read untracked; authored callbacks retain tracking. */
  readonly routedComparisons?: ReadonlyMap<Node, BindingNode>;
}

export interface SourceFlowPlan {
  readonly elements: ReadonlyMap<Extract<Node, { type: 'JSXElement' }>, SourceInputPlan>;
  readonly callbackStatements: ReadonlyMap<Statement, SourceInputPlan>;
  readonly builders: ReadonlyMap<Node, SourceBuilderPlan>;
  readonly bindingBuilders: ReadonlyMap<BindingNode, readonly Node[]>;
  readonly suspends: ReadonlyMap<Extract<Node, { type: 'JSXElement' }>, readonly Node[]>;
  readonly retained: ReadonlyMap<Expression, SourceInputPlan>;
  readonly payloadReads: readonly Node[];
  readonly memberObjects: readonly Expression[];
  readonly guards: ReadonlyMap<Expression, SourceInputPlan>;
  readonly patterns: ReadonlyMap<VariableDeclarator, SourceInputPlan>;
  readonly groups: readonly Extract<Node, { type: 'JSXElement' }>[];
  readonly calls: readonly { readonly call: Extract<Node, { type: 'CallExpression' }>; readonly read: boolean }[];
  readonly moduleSources: readonly { readonly declaration: VariableDeclarator; readonly call: Expression }[];
}

export interface SourceBuilderPlan {
  readonly inputs: SourceInputPlan;
  readonly targets: readonly BindingNode[];
  /**
   * The targets it definitely builds. Once later writes take all of them over,
   * the statement is skipped (decisions, 2026-10-19), so it no longer makes the
   * values it only may change wait.
   */
  readonly definite: readonly BindingNode[];
  readonly owner: Node | null;
}

/** Native branches choose their own readiness inputs; inactive branches add none. */
export interface SourceInputPlan {
  readonly reads: readonly {
    readonly value: Node;
    readonly status: boolean;
    readonly path: readonly string[];
  }[];
  readonly branches: readonly SourceBranchInputs[];
}

export type SourceBranchInputs =
  | {
    readonly kind: 'branch';
    readonly operator: '?' | '&&' | '||' | '??';
    readonly test: Expression;
    readonly testInputs: SourceInputPlan;
    readonly consequent: SourceInputPlan;
    readonly alternate: SourceInputPlan;
  }
  | {
    readonly kind: 'switch';
    readonly test: Expression;
    readonly testInputs: SourceInputPlan;
    readonly cases: readonly {
      readonly test: Expression | null;
      readonly testInputs: SourceInputPlan;
      readonly body: SourceInputPlan;
      readonly ends: boolean;
    }[];
  };

export interface RenderValuePlan {
  /** Identity of the JSX creation expression, shared across its consumers. */
  readonly node: Extract<Node, { type: 'JSXElement' | 'JSXFragment' }>;
  readonly template: Template;
  /** Source order is also the capture-array order used by the emitted program. */
  readonly sites: readonly Site[];
  /** Capture index of the root's final `key` attribute, or null without one. */
  readonly keyIndex: number | null;
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
