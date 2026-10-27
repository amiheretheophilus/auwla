/** Compose readiness, handle reads and lexical presentation on fresh syntax. */
import { b, is } from 'yuku-ast';
import type { Expression, Node, Statement } from 'yuku-parser';
import type { ModulePlan, SourceInputPlan } from '../../core/plan/model';
import type { Names } from '../../core/emit/names';
import { copy, finishCopy } from '../../core/emit/copy';
import { expression, numberLiteral, statement, stringLiteral } from '../../core/emit/quote';
import { cleanJsxText } from '../../core/plan/jsx';
import type { BindingNode } from '../../core/graph';

export function emitSourceFlow(
  plan: ModulePlan,
  names: Names,
  _runtime: string,
  data: string,
  initial: ReadonlyMap<Node, Node>,
) {
  const flow = plan.sourceFlow;
  const replacements = new Map(initial);
  const declarations: Statement[] = [];
  const module = plan.module.module;
  const groupPolicies = new Map(flow?.groups.map((group) => [group, names.fresh('_groupPolicy')]) ?? []);
  const blockedSteps = sourceBlockedSteps(plan, names);
  const takenBindings = sourceTakeovers(plan, names, data);
  const changedBindings = sourceChanges(plan, names, data);

  const policyOf = (node: Node): Expression => {
    for (const ancestor of module.ancestors(node)) {
      const policy = groupPolicies.get(ancestor as never);

      if (policy !== undefined && is.JSXElement(ancestor)
        && ancestor.children.some((child) => node.start >= child.start && node.end <= child.end)) {
        return expression('$$policy', { policy });
      }

      if (plan.components.has(ancestor)) {
        return expression('$$policy', { policy: names.of(ancestor, '_sourcePolicy') });
      }
    }

    return expression('void 0');
  };

  const suspendValue = (node: Extract<Node, { type: 'JSXElement' }>, value: Expression): Expression => {
    const inputs = flow?.suspends.get(node);

    if (inputs === undefined) {
      return value;
    }

    return expression('$$data.createSuspendedSourceValue($$site, () => $$value, $$policy, () => $$inputs)', {
      data,
      site: stringLiteral(`${plan.module.path}:${node.start}`),
      value,
      policy: policyOf(node),
      inputs: b.ArrayExpression({ elements: inputs.map((input) => finishCopy(copy(input as Expression, initial))) }),
    });
  };

  const elementValue = (node: Extract<Node, { type: 'JSXElement' }>, value: Expression): Expression => {
    const inputs = flow?.elements.get(node);

    if (inputs === undefined) {
      return value;
    }

    const guarded = sourceInputs(inputs, names, data, replacements, (input) => finishCopy(copy(input as Expression, initial)));
    const result = expression('$$data.whenSourceInputs(() => $$inputs, () => $$value)', {
      data,
      inputs: guarded.inputs,
      value: copy(value, guarded.replacements),
    });

    return expression('$$data.presentSourceValue($$value, $$policy)', {
      data,
      value: withChoices(guarded.cache, result),
      policy: policyOf(node),
    });
  };

  if (flow === undefined) {
    return { replacements, policyOf, declarations, suspendValue, elementValue, blockedSteps, takenBindings, changedBindings };
  }

  const raw = (node: Node, ignore?: Node): Expression => {
    // A readiness input must retain its handle. Freeze only this generated read,
    // so later payload rewrites cannot turn a probe into an unguarded read.
    let value = copy(node as Expression, initial);
    const binding = module.bindingOf(node);
    const target = binding === null ? undefined : [...flow.bindingBuilders.keys()].find((entry) => entry.binding === binding);

    // Shared readers expose readiness only to a guard. Imperative reads still
    // return the actual native value, even while a possible builder is waiting.
    if (initial.has(node) && is.CallExpression(value) && is.Identifier(value.callee) && value.arguments.length === 0) {
      value.arguments.push(ignore === undefined ? expression('true') : expression('$$step', { step: names.of(ignore, '_sourceStep') }));
    }

    if (target !== undefined) {
      value = expression('$$data.sourceBindingInput($$value, $$cell, $$ignore)', {
        data,
        value,
        cell: names.of(target.binding.declarations[0]!, '_sourceBinding'),
        ignore: ignore === undefined ? expression('void 0') : expression('$$step', { step: names.of(ignore, '_sourceStep') }),
      });
    }

    return finishCopy(value);
  };

  for (const node of flow.payloadReads) {
    replacements.set(node, expression('$$data.readSourceValue($$value)', { data, value: copy(node, initial) }));
  }

  for (const object of flow.memberObjects) {
    replacements.set(object, expression('$$data.readSourceValue($$value)', {
      data,
      value: copy(object, replacements),
    }));
  }

  for (const { call, read } of flow.calls) {
    const created = copy(call, replacements);

    if (read && created.arguments.length === 1) {
      created.arguments.push(expression('() => $$promise', {
        promise: copy(call.arguments[0]!, replacements),
      }));
    }

    replacements.set(call, expression('$$data.captureCreatedSource(() => $$created)', { data, created }));
  }

  for (const [root, inputs] of flow.retained) {
    const guarded = sourceInputs(inputs, names, data, replacements, raw);
    const value = copy(root, guarded.replacements);

    const retained = expression('$$data.retainSourceValue($$site, () => $$inputs, () => $$value)', {
      data,
      site: stringLiteral(`${plan.module.path}:${root.start}`),
      inputs: guarded.inputs,
      value,
    });

    replacements.set(root, withChoices(guarded.cache, retained));
  }

  for (const { declaration, call } of flow.moduleSources) {
    const reference = names.fresh('_moduleSource');

    declarations.push(statement('const $$reference = $$data.describeSourceValue($$site, () => $$value);', {
      reference,
      data,
      site: stringLiteral(`${plan.module.path}:${declaration.start}`),
      value: copy(call, replacements),
    }));

    replacements.set(call, expression('$$reference', { reference }));
  }

  for (const [root, inputs] of flow.guards) {
    const builder = [...flow.builders.keys()].find((step) => is.VariableDeclarator(step) && step.init === root);
    const guarded = sourceInputs(inputs, names, data, replacements, (node) => raw(node, builder));
    const value = copy(root, guarded.replacements);
    const body = expression('$$data.whenSourceInputs(() => $$inputs, () => $$value)', {
      data,
      inputs: guarded.inputs,
      value,
    });

    replacements.set(root, withChoices(guarded.cache, body));
  }

  for (const [root, builder] of flow.builders) {
    const step = names.of(root, '_sourceStep');

    if (is.VariableDeclarator(root)) {
      if (root.init !== null) {
        replacements.set(root.init, expression('$$data.recordSourceBuilder($$step, $$value)', {
          data,
          step,
          value: copy(root.init, replacements),
        }));
      }

      continue;
    }

    const guarded = sourceInputs(builder.inputs, names, data, replacements, (node) => raw(node, root));
    const body = copy(root, guarded.replacements);
    const waiting = names.fresh('_builderWaiting');
    const evaluation = names.fresh('_builderEvaluation');

    replacements.set(root, b.BlockStatement({ body: [
      ...(guarded.cache === null ? [] : [statement('const $$cache = [];', { cache: guarded.cache })]),
      statement('const $$evaluation = $$data.beginSourceEvaluation();', { evaluation, data }),
      statement('const $$waiting = $$data.sourceBuilderWaiting(() => $$inputs);', { waiting, data, inputs: guarded.inputs }),
      b.IfStatement({
        test: expression('$$waiting === void 0', { waiting }),
        consequent: b.BlockStatement({ body: [body as Statement] }),
        alternate: statement('$$data.recordSourceWaiting($$waiting);', { data, waiting }),
      }),
      statement('$$data.settleSourceStep($$step, $$data.finishSourceEvaluation($$evaluation));', { step, data, evaluation }),
    ] }));
  }

  for (const [root, inputs] of flow.callbackStatements) {
    const guarded = sourceInputs(inputs, names, data, replacements, raw);
    const waiting = names.fresh('_callbackWaiting');
    const body = copy(root, guarded.replacements);

    replacements.set(root, b.BlockStatement({ body: [
      ...(guarded.cache === null ? [] : [statement('const $$cache = [];', { cache: guarded.cache })]),
      statement('const $$waiting = $$data.sourceBuilderWaiting(() => $$inputs);', { waiting, data, inputs: guarded.inputs }),
      b.IfStatement({
        test: expression('$$waiting === void 0', { waiting }),
        consequent: b.BlockStatement({ body: [body] }),
        alternate: statement('$$data.recordSourceWaiting($$waiting);', { data, waiting }),
      }),
    ] }));
  }

  for (const [declaration] of flow.patterns) {
    const bindings = module.bindings.filter((binding) => binding.declarations.some((node) => {
      return node.start >= declaration.id.start && node.end <= declaration.id.end;
    }));

    const payload = names.fresh('_patternPayload');
    const nativePattern = finishCopy(copy(declaration.id, replacements));
    const values = b.ArrayExpression({ elements: bindings.map((binding) => expression('$$name', { name: binding.name })) });
    const compute = expression('($$payload) => { const $$pattern = $$payload; return $$values; }', {
      payload,
      pattern: nativePattern,
      values,
    });

    const value = declaration.init === null ? expression('void 0') : copy(declaration.init, replacements);
    const namesPattern = b.ArrayPattern({ elements: bindings.map((binding) => copy(binding.declarations[0]!) as Extract<Node, { type: 'Identifier' }>) });

    replacements.set(declaration.id, namesPattern);
    replacements.set(declaration.init!, expression('$$data.destructureSourceInputs($$value, () => [], $$compute, $$count)', {
      data,
      value,
      compute,
      count: numberLiteral(bindings.length),
    }));
  }

  for (const container of module.findAll('JSXExpressionContainer')) {
    const parent = module.parentOf(container);

    if (is.JSXEmptyExpression(container.expression) || is.JSXAttribute(parent) || is.Function(container.expression)) {
      continue;
    }

    const root = container.expression;

    replacements.set(root, expression('$$data.presentSourceValue($$value, $$policy)', {
      data,
      value: copy(root, replacements),
      policy: policyOf(root),
    }));
  }

  for (const group of flow.groups) {
    const policy = groupPolicies.get(group)!;
    const properties: Extract<Node, { type: 'ObjectExpression' }>['properties'] = [];

    for (const attribute of group.openingElement.attributes) {
      if (is.JSXSpreadAttribute(attribute)) {
        properties.push(b.SpreadElement({ argument: attribute.argument }));
      } else if (is.JSXIdentifier(attribute.name) && attribute.name.name !== 'suspend') {
        properties.push(b.Property({
          key: stringLiteral(attribute.name.name),
          value: attribute.value === null ? expression('true')
            : is.JSXExpressionContainer(attribute.value) ? attribute.value.expression as Expression
            : attribute.value as Expression,
          kind: 'init',
          method: false,
          shorthand: false,
          computed: false,
        }) as never);
      }
    }

    const children: Expression[] = [];

    for (const child of group.children) {
      if (is.JSXText(child)) {
        const text = cleanJsxText(child.value);

        if (text !== '') {
          children.push(stringLiteral(text));
        }
      } else if (is.JSXExpressionContainer(child)) {
        if (!is.JSXEmptyExpression(child.expression)) {
          children.push(child.expression);
        }
      } else if (is.JSXSpreadChild(child)) {
        children.push(b.SpreadElement({ argument: child.expression }) as unknown as Expression);
      } else {
        children.push(child as Expression);
      }
    }

    const childrenValue = b.ArrayExpression({ elements: children });
    const suspended = flow.suspends.get(group);
    const content = suspended === undefined ? childrenValue : expression('$$data.createSuspendedSourceValue($$site, () => $$children, $$policy, () => $$inputs)', {
      data,
      site: stringLiteral(`${plan.module.path}:${group.start}`),
      children: childrenValue,
      policy,
      inputs: b.ArrayExpression({ elements: suspended.map((node) => raw(node)) }),
    });

    replacements.set(group, expression('(($$policy) => $$children)($$data.mergeSourcePresentation($$inherited, $$props))', {
      policy,
      children: content,
      data,
      inherited: policyOf(group),
      props: b.ObjectExpression({ properties }),
    }));
  }

  for (const fn of module.findAll(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])) {
    if (plan.components.has(fn) || plan.sharedOwners.some((owner) => owner.fn === fn)
      || !is.BlockStatement(fn.body)) {
      continue;
    }

    const storage = sourceReadinessStorage(plan, fn, names);

    if (storage.length > 0) {
      const body = copy(fn.body, replacements);

      replacements.set(fn.body, b.BlockStatement({ body: [...storage, ...body.body] }));
    }
  }

  return { replacements, policyOf, declarations, suspendValue, elementValue, blockedSteps, takenBindings, changedBindings };
}

/** Each invocation owns its pending builder records, alongside native bindings. */
export function sourceReadinessStorage(plan: ModulePlan, owner: Node | null, names: Names): Statement[] {
  const flow = plan.sourceFlow;
  const declarations: Statement[] = [];

  for (const [root, builder] of flow?.builders ?? []) {
    if (builder.owner === owner) {
      // `builds` counts the values it definitely builds that no write took over
      // yet (`takeSourceBinding`); a step that builds none definitely has none.
      const step = names.of(root, '_sourceStep');

      declarations.push(builder.definite.length === 0
        ? statement('const $$step = { waiting: void 0 };', { step })
        : statement('const $$step = { waiting: void 0, builds: $$builds };', {
          step,
          builds: expression(String(builder.definite.length)),
        }));
    }
  }

  for (const [binding, steps] of flow?.bindingBuilders ?? []) {
    if (binding.owner.runner !== owner) {
      continue;
    }

    const stepOf = (step: Node) => expression('$$step', { step: names.of(step, '_sourceStep') });
    const possible = steps.filter((step) => !flow!.builders.get(step)!.definite.includes(binding));

    declarations.push(statement('const $$cell = { taken: false, steps: $$steps, possible: $$possible };', {
      cell: names.of(binding.binding.declarations[0]!, '_sourceBinding'),
      steps: b.ArrayExpression({ elements: steps.map(stepOf) }),
      possible: b.ArrayExpression({ elements: possible.map(stepOf) }),
    }));
  }

  return declarations;
}

/**
 * For each step, what its builder observation runs when it sees the step
 * change a value it only may change. The memo engine owns that observation;
 * readiness only needs to hear of the change (`noteSourceChange`).
 */
export function sourceChanges(
  plan: ModulePlan, names: Names, data: string | undefined,
): ReadonlyMap<Node, ReadonlyMap<BindingNode, Expression>> {
  const flow = plan.sourceFlow;

  if (flow === undefined || data === undefined) {
    return new Map();
  }

  return new Map([...flow.builders].map(([step, builder]) => [step, new Map(builder.targets
    .filter((target) => !builder.definite.includes(target))
    .map((target) => [target, expression('$$data.noteSourceChange($$step, $$cell)', {
      data,
      step: names.of(step, '_sourceStep'),
      cell: names.of(target.binding.declarations[0]!, '_sourceBinding'),
    })]))]));
}

export function sourceBlockedSteps(plan: ModulePlan, names: Names): ReadonlyMap<Node, Expression> {
  return new Map([...(plan.sourceFlow?.builders.keys() ?? [])].map((step) => [step,
    expression('$$step.waiting !== void 0', { step: names.of(step, '_sourceStep') }),
  ]));
}

/** A later write takes the binding over and releases the steps it alone kept running. */
export function sourceTakeovers(
  plan: ModulePlan, names: Names, data: string | undefined,
): ReadonlyMap<BindingNode, Expression> {
  const flow = plan.sourceFlow;

  if (flow === undefined || data === undefined) {
    return new Map();
  }

  return new Map([...flow.bindingBuilders.keys()].map((binding) => {
    const builds = [...flow.builders]
      .filter(([, builder]) => builder.definite.includes(binding))
      .map(([step]) => expression('$$step', { step: names.of(step, '_sourceStep') }));

    return [binding, expression('$$data.takeSourceBinding($$cell, $$builds)', {
      data,
      cell: names.of(binding.binding.declarations[0]!, '_sourceBinding'),
      builds: b.ArrayExpression({ elements: builds }),
    })];
  }));
}

function withChoices(cache: string | null, value: Expression): Expression {
  return cache === null ? value : expression('(($$cache) => $$value)([])', { cache, value });
}

function sourceInputs(
  plan: SourceInputPlan,
  names: Names,
  data: string,
  initial: ReadonlyMap<Node, Node>,
  raw: (node: Node) => Expression,
) {
  const replacements = new Map(initial);
  const cache = plan.branches.length === 0 ? null : names.fresh('_sourceChoices');
  let nextChoice = 0;

  const choice = (test: Expression): Expression => {
    const index = nextChoice++;
    const value = copy(test, initial);
    const cached = expression('$$data.sourceChoice($$cache, $$index, () => $$value)', {
      data,
      cache: cache!,
      index: numberLiteral(index),
      value,
    });

    replacements.set(test, cached);

    return cached;
  };

  const inputsOf = (input: SourceInputPlan): Expression => {
    const elements: Extract<Node, { type: 'ArrayExpression' }>['elements'] = input.reads.map((read) => {
      let value = raw(read.value);

      if (read.path.length > 0) {
        value = expression('$$data.sourcePathInput($$value, $$keys)', {
          data,
          value,
          keys: b.ArrayExpression({ elements: read.path.map(stringLiteral) }),
        });
      }

      return read.status ? expression('$$data.sourceStatusInput($$value)', { data, value }) : value;
    });

    for (const branch of input.branches) {
      const testInputs = inputsOf(branch.testInputs);
      const test = choice(branch.test);
      let selected: Expression;

      if (branch.kind === 'branch') {
        selected = expression('$$data.sourceBranchInputs($$operator, () => $$testInputs, () => $$test, () => $$first, () => $$second)', {
          data,
          operator: stringLiteral(branch.operator),
          testInputs,
          test,
          first: inputsOf(branch.consequent),
          second: inputsOf(branch.alternate),
        });
      } else {
        const cases = branch.cases.map((entry) => expression('({ test: $$test, inputs: () => $$inputs, body: () => $$body, ends: $$ends })', {
          test: entry.test === null ? expression('null') : expression('() => $$value', { value: choice(entry.test) }),
          inputs: inputsOf(entry.testInputs),
          body: inputsOf(entry.body),
          ends: expression(entry.ends ? 'true' : 'false'),
        }));

        selected = expression('$$data.sourceSwitchInputs(() => $$inputs, () => $$test, $$cases)', {
          data,
          inputs: testInputs,
          test,
          cases: b.ArrayExpression({ elements: cases }),
        });
      }

      elements.push(b.SpreadElement({ argument: selected }));
    }

    return b.ArrayExpression({ elements });
  };

  return { inputs: inputsOf(plan), cache, replacements };
}
