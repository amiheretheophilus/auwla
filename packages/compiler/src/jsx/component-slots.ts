/** Compiler-owned `<slot>` declarations and call-site content partitioning. */

import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { walkAst, type BaseNode } from '../ast';
import type { Ctx, ProgramPath } from '../context';
import { analyzeComponentPropShape } from '../components/prop-shape';

export interface ComponentSlotDefinition {
  /** Empty string denotes the default slot. */
  readonly name: string;
  /** Compiler-private render-prop name used by the existing slot ABI. */
  readonly prop: string;
}

const SLOT_PROP_PREFIX = '__memoizedSlot_';

export function componentSlotProp(name: string): string {
  if (name === '') return `${SLOT_PROP_PREFIX}default`;
  const encoded = [...name]
    .map((character) => character.codePointAt(0)!.toString(16))
    .join('_');
  return `${SLOT_PROP_PREFIX}named_${encoded}`;
}

function topLevelComponents(program: t.Program): t.FunctionDeclaration[] {
  const output: t.FunctionDeclaration[] = [];
  for (const statement of program.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ||
      astFactory.isExportDefaultDeclaration(statement)
      ? statement.declaration
      : statement;
    if (
      astFactory.isFunctionDeclaration(declaration) &&
      declaration.id !== null &&
      /^[A-Z]/.test(declaration.id.name)
    ) {
      output.push(declaration);
    }
  }
  return output;
}

function jsxName(element: t.JSXElement): string | null {
  return astFactory.isJSXIdentifier(element.openingElement.name)
    ? element.openingElement.name.name
    : null;
}

function attributeName(attribute: t.JSXAttribute): string {
  return astFactory.isJSXIdentifier(attribute.name)
    ? attribute.name.name
    : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
}

function staticAttributeValue(attribute: t.JSXAttribute): string | null {
  const value = attribute.value;
  if (astFactory.isStringLiteral(value)) return value.value;
  if (
    astFactory.isJSXExpressionContainer(value) &&
    astFactory.isStringLiteral(value.expression)
  ) {
    return value.expression.value;
  }
  return null;
}

function slotName(
  element: t.JSXElement,
  attribute: 'name' | 'slot',
  fail: (message: string, at: t.Node) => never,
): string | null {
  const matches = element.openingElement.attributes.filter(
    (candidate): candidate is t.JSXAttribute =>
      astFactory.isJSXAttribute(candidate) && attributeName(candidate) === attribute,
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    return fail(`memo-dom: <slot> has more than one '${attribute}' attribute`, element);
  }
  const value = staticAttributeValue(matches[0]!);
  if (value === null || value === '') {
    return fail(
      `memo-dom: slot ${attribute} must be a non-empty static string literal`,
      matches[0]!,
    );
  }
  return value;
}

function slotsInComponent(
  component: t.FunctionDeclaration,
  fail: (message: string, at: t.Node) => never,
): ComponentSlotDefinition[] {
  const definitions: ComponentSlotDefinition[] = [];
  const seen = new Set<string>();
  walkAst<BaseNode>(component.body as unknown as BaseNode, {
    enter(node) {
      if (node !== component.body && astFactory.isFunction(node)) return false;
      if (!astFactory.isJSXElement(node)) return;
      const element = node as unknown as t.JSXElement;
      if (jsxName(element) !== 'slot') return;
      for (const attribute of element.openingElement.attributes) {
        if (!astFactory.isJSXAttribute(attribute)) {
          return fail('memo-dom: <slot> does not accept spread attributes', attribute);
        }
        const name = attributeName(attribute);
        if (name !== 'name' && name !== 'slot') {
          return fail(`memo-dom: unsupported <slot> attribute '${name}'`, attribute);
        }
      }
      const name = slotName(element, 'name', fail) ?? '';
      // A forwarding destination is validated when the containing component
      // call is partitioned; reading it here still rejects dynamic values.
      slotName(element, 'slot', fail);
      if (seen.has(name)) {
        return fail(
          `memo-dom: component '${component.id!.name}' declares slot '${name || 'default'}' more than once`,
          element,
        );
      }
      seen.add(name);
      definitions.push({ name, prop: componentSlotProp(name) });
    },
  });
  return definitions;
}

/** Read local slot declarations without mutating the program. */
export function discoverComponentSlots(
  program: t.Program,
  fail: (message: string, at: t.Node) => never = (message) => {
    throw new Error(message);
  },
): Map<string, ComponentSlotDefinition[]> {
  const result = new Map<string, ComponentSlotDefinition[]>();
  for (const component of topLevelComponents(program)) {
    const definitions = slotsInComponent(component, fail);
    if (definitions.length > 0) result.set(component.id!.name, definitions);
  }
  return result;
}

function parameterTarget(parameter: t.FunctionDeclaration['params'][number]): t.Node {
  return astFactory.isAssignmentPattern(parameter) ? parameter.left : parameter;
}

function genericObjectBinding(component: t.FunctionDeclaration): string | null {
  if (component.params.length !== 1) return null;
  const target = parameterTarget(component.params[0]!);
  return astFactory.isIdentifier(target) && target.name === 'props'
    ? target.name
    : null;
}

function componentReadsGenericProp(
  component: t.FunctionDeclaration,
  binding: string,
  prop: string,
): boolean {
  let found = false;
  walkAst<BaseNode>(component.body as unknown as BaseNode, {
    enter(node) {
      if (found) return false;
      if (node !== component.body && astFactory.isFunction(node)) return false;
      if (
        astFactory.isMemberExpression(node) &&
        astFactory.isIdentifier(node.object, { name: binding }) &&
        ((!node.computed && astFactory.isIdentifier(node.property, { name: prop })) ||
          (node.computed && astFactory.isStringLiteral(node.property) && node.property.value === prop))
      ) {
        found = true;
        return false;
      }
      if (
        astFactory.isVariableDeclarator(node) &&
        astFactory.isIdentifier(node.init, { name: binding }) &&
        astFactory.isObjectPattern(node.id) &&
        node.id.properties.some((property) =>
          astFactory.isObjectProperty(property) &&
          !property.computed &&
          ((astFactory.isIdentifier(property.key) && property.key.name === prop) ||
            (astFactory.isStringLiteral(property.key) && property.key.value === prop)),
        )
      ) {
        found = true;
        return false;
      }
    },
  });
  return found;
}

function addSlotParameters(
  component: t.FunctionDeclaration,
  definitions: readonly ComponentSlotDefinition[],
): Map<string, t.Expression> {
  const accessors = new Map<string, t.Expression>();
  const objectBinding = genericObjectBinding(component);
  if (objectBinding !== null) {
    const parameter = component.params[0]!;
    const target = parameterTarget(parameter) as t.Identifier;
    const properties = definitions.map((definition) =>
      astFactory.objectProperty(
        astFactory.identifier(definition.prop),
        astFactory.identifier(definition.prop),
        false,
        true,
      ),
    );
    const pattern: t.ObjectPattern = {
      type: 'ObjectPattern',
      properties: [
        ...properties,
        { type: 'RestElement', argument: astFactory.identifier(objectBinding) },
      ],
      ...(target.typeAnnotation == null
        ? {}
        : { typeAnnotation: target.typeAnnotation }),
    };
    if (astFactory.isAssignmentPattern(parameter)) parameter.left = pattern;
    else component.params[0] = pattern;
    for (const definition of definitions) {
      accessors.set(definition.name, astFactory.identifier(definition.prop));
    }
    return accessors;
  }

  const first = component.params[0];
  const firstTarget = first === undefined ? null : parameterTarget(first);
  if (firstTarget !== null && astFactory.isObjectPattern(firstTarget)) {
    const restIndex = firstTarget.properties.findIndex((property) =>
      astFactory.isRestElement(property),
    );
    const properties = definitions.map((definition) =>
      astFactory.objectProperty(
        astFactory.identifier(definition.prop),
        astFactory.identifier(definition.prop),
        false,
        true,
      ),
    );
    if (restIndex === -1) firstTarget.properties.push(...properties);
    else firstTarget.properties.splice(restIndex, 0, ...properties);
  } else {
    component.params.push(
      ...definitions.map((definition) => astFactory.identifier(definition.prop)),
    );
  }
  for (const definition of definitions) {
    accessors.set(definition.name, astFactory.identifier(definition.prop));
  }
  return accessors;
}

function replaceChild(
  parent: BaseNode,
  key: string | undefined,
  index: number | undefined,
  replacement: t.JSXFragment,
): void {
  if (key === undefined) throw new Error('memo-dom: detached <slot> placeholder');
  const record = parent as unknown as Record<string, unknown>;
  if (index === undefined) record[key] = replacement;
  else (record[key] as unknown[])[index] = replacement;
}

function rewriteSlotPlaceholders(
  component: t.FunctionDeclaration,
  accessors: ReadonlyMap<string, t.Expression>,
  fail: (message: string, at: t.Node) => never,
): void {
  walkAst<BaseNode>(component.body as unknown as BaseNode, {
    enter(node) {
      if (node !== component.body && astFactory.isFunction(node)) return false;
    },
    leave(node, parent, key, index) {
      if (!astFactory.isJSXElement(node) || parent === null) return;
      const element = node as unknown as t.JSXElement;
      if (jsxName(element) !== 'slot') return;
      const name = slotName(element, 'name', fail) ?? '';
      const accessor = accessors.get(name);
      if (accessor === undefined) {
        return fail(`memo-dom: missing compiler slot binding '${name || 'default'}'`, element);
      }
      const fallback = element.children.length === 0
        ? accessor
        : astFactory.conditionalExpression(
            astFactory.binaryExpression('==', accessor, astFactory.nullLiteral()),
            astFactory.jsxFragment(
              astFactory.jsxOpeningFragment(),
              astFactory.jsxClosingFragment(),
              element.children,
            ),
            accessor,
          );
      replaceChild(
        parent,
        key,
        index,
        astFactory.jsxFragment(
          astFactory.jsxOpeningFragment(),
          astFactory.jsxClosingFragment(),
          [astFactory.jsxExpressionContainer(fallback)],
        ),
      );
    },
  });
}

function removeSlotMarker(
  element: t.JSXElement,
  fail: (message: string, at: t.Node) => never,
): string | null {
  const name = slotName(element, 'slot', fail);
  if (name === null) return null;
  element.openingElement.attributes = element.openingElement.attributes.filter(
    (attribute) =>
      !astFactory.isJSXAttribute(attribute) || attributeName(attribute) !== 'slot',
  );
  return name;
}

type Assignment =
  | { kind: 'empty' }
  | { kind: 'default' }
  | { kind: 'named'; name: string }
  | { kind: 'mixed' };

function mergeAssignments(left: Assignment, right: Assignment): Assignment {
  if (left.kind === 'mixed' || right.kind === 'mixed') return { kind: 'mixed' };
  if (left.kind === 'empty') return right;
  if (right.kind === 'empty') return left;
  if (left.kind === 'default' && right.kind === 'default') return left;
  if (left.kind === 'named' && right.kind === 'named' && left.name === right.name) return left;
  return { kind: 'mixed' };
}

function expressionAssignment(
  expression: t.Expression,
  fail: (message: string, at: t.Node) => never,
): Assignment {
  if (astFactory.isJSXElement(expression)) {
    const name = removeSlotMarker(expression, fail);
    return name === null ? { kind: 'default' } : { kind: 'named', name };
  }
  if (astFactory.isJSXFragment(expression)) return { kind: 'default' };
  if (
    astFactory.isNullLiteral(expression) ||
    astFactory.isBooleanLiteral(expression) ||
    astFactory.isIdentifier(expression, { name: 'undefined' })
  ) {
    return { kind: 'empty' };
  }
  if (astFactory.isLogicalExpression(expression)) {
    return expressionAssignment(expression.right, fail);
  }
  if (astFactory.isConditionalExpression(expression)) {
    return mergeAssignments(
      expressionAssignment(expression.consequent, fail),
      expressionAssignment(expression.alternate, fail),
    );
  }
  return { kind: 'default' };
}

function childAssignment(
  child: t.JSXElement['children'][number],
  fail: (message: string, at: t.Node) => never,
): Assignment {
  if (astFactory.isJSXElement(child)) {
    const name = removeSlotMarker(child, fail);
    return name === null ? { kind: 'default' } : { kind: 'named', name };
  }
  if (
    astFactory.isJSXExpressionContainer(child) &&
    astFactory.isExpression(child.expression)
  ) {
    return expressionAssignment(child.expression, fail);
  }
  return { kind: 'default' };
}

function meaningful(children: readonly t.JSXElement['children'][number][]): boolean {
  return children.some(
    (child) => !astFactory.isJSXText(child) || child.value !== '',
  );
}

function addSlotContentAttribute(
  element: t.JSXElement,
  definition: ComponentSlotDefinition,
  children: t.JSXElement['children'],
  fail: (message: string, at: t.Node) => never,
): void {
  if (
    element.openingElement.attributes.some(
      (attribute) =>
        astFactory.isJSXAttribute(attribute) &&
        attributeName(attribute) === definition.prop,
    )
  ) {
    fail(`memo-dom: '${definition.prop}' is a reserved compiler slot prop`, element);
  }
  element.openingElement.attributes.push(
    astFactory.jsxAttribute(
      astFactory.jsxIdentifier(definition.prop),
      astFactory.jsxExpressionContainer(
        astFactory.jsxFragment(
          astFactory.jsxOpeningFragment(),
          astFactory.jsxClosingFragment(),
          children,
        ),
      ),
    ),
  );
}

function normalizeSlotCalls(
  ctx: Ctx,
  program: t.Program,
  localSlots: ReadonlyMap<string, readonly ComponentSlotDefinition[]>,
  localComponents: ReadonlySet<string>,
  fail: (message: string, at: t.Node) => never,
): void {
  walkAst<BaseNode>(program as unknown as BaseNode, {
    enter(node) {
      if (!astFactory.isJSXElement(node)) return;
      const element = node as unknown as t.JSXElement;
      const tag = jsxName(element);
      if (tag === null || !/^[A-Z]/.test(tag)) return;
      const definitions = localSlots.get(tag) ??
        ctx.importedComponents.get(tag)?.slots?.map((name) => ({
          name,
          prop: componentSlotProp(name),
        }));
      if (definitions === undefined || definitions.length === 0) {
        if (localComponents.has(tag) || ctx.importedComponents.has(tag)) {
          for (const child of element.children) {
            const assignment = childAssignment(child, fail);
            if (assignment.kind === 'named' || assignment.kind === 'mixed') {
              return fail(
                `memo-dom: <${tag}> does not declare compiler slots`,
                child,
              );
            }
          }
        }
        return;
      }

      for (const attribute of element.openingElement.attributes) {
        if (
          astFactory.isJSXAttribute(attribute) &&
          attributeName(attribute).startsWith(SLOT_PROP_PREFIX)
        ) {
          return fail(
            `memo-dom: '${attributeName(attribute)}' is reserved for compiler slots`,
            attribute,
          );
        }
      }

      if (
        element.openingElement.attributes.some(
          (attribute) =>
            astFactory.isJSXAttribute(attribute) &&
            attributeName(attribute) === 'children',
        )
      ) {
        return fail(`memo-dom: slot component <${tag}> cannot receive a children prop`, element);
      }

      const byName = new Map(definitions.map((definition) => [definition.name, definition]));
      const buckets = new Map<string, t.JSXElement['children']>();
      for (const child of element.children) {
        const assignment = childAssignment(child, fail);
        if (assignment.kind === 'mixed') {
          return fail(
            `memo-dom: conditional slot content on <${tag}> must target the same static slot in every rendered branch`,
            child,
          );
        }
        const name = assignment.kind === 'named' ? assignment.name : '';
        if (!byName.has(name)) {
          return fail(
            name === ''
              ? `memo-dom: <${tag}> does not declare a default slot`
              : `memo-dom: <${tag}> does not declare slot '${name}'`,
            child,
          );
        }
        const bucket = buckets.get(name) ?? [];
        bucket.push(child);
        buckets.set(name, bucket);
      }
      for (const [name, children] of buckets) {
        if (!meaningful(children)) continue;
        addSlotContentAttribute(element, byName.get(name)!, children, fail);
      }
      element.children = [];
    },
  });
}

function rejectLeftoverSlotMarkers(
  program: t.Program,
  fail: (message: string, at: t.Node) => never,
): void {
  walkAst<BaseNode>(program as unknown as BaseNode, {
    enter(node) {
      if (!astFactory.isJSXElement(node)) return;
      const element = node as unknown as t.JSXElement;
      const marker = element.openingElement.attributes.find(
        (attribute) =>
          astFactory.isJSXAttribute(attribute) && attributeName(attribute) === 'slot',
      );
      if (marker !== undefined) {
        return fail(
          "memo-dom: a 'slot' assignment must be a direct child of a component that declares that slot",
          marker,
        );
      }
    },
  });
}

/**
 * Normalize authored component slots to private render props before ordinary
 * component and render-prop analysis. No slot helper is exposed to authors.
 */
export function normalizeComponentSlots(ctx: Ctx, programPath: ProgramPath): void {
  const fail = (message: string, at: t.Node): never => {
    throw programPath.buildCodeFrameError(message, at);
  };
  const localSlots = discoverComponentSlots(programPath.node, fail);
  ctx.componentSlots = new Map(
    [...localSlots].map(([component, definitions]) => [
      component,
      definitions.map((definition) => definition.name),
    ]),
  );

  for (const component of topLevelComponents(programPath.node)) {
    const definitions = localSlots.get(component.id!.name);
    if (definitions === undefined) continue;
    const shape = analyzeComponentPropShape(component.params as unknown as BaseNode[]);
    if (shape.names.includes('children')) {
      fail(
        `memo-dom: component '${component.id!.name}' cannot declare both <slot> and a children prop`,
        component,
      );
    }
    for (const definition of definitions) {
      if (definition.name !== '' && shape.names.includes(definition.name)) {
        fail(
          `memo-dom: slot '${definition.name}' conflicts with a prop of the same name on '${component.id!.name}'`,
          component,
        );
      }
      if (shape.names.includes(definition.prop)) {
        fail(`memo-dom: '${definition.prop}' is reserved for compiler slots`, component);
      }
    }
    const objectBinding = genericObjectBinding(component);
    if (
      objectBinding !== null &&
      componentReadsGenericProp(component, objectBinding, 'children')
    ) {
      fail(
        `memo-dom: component '${component.id!.name}' cannot use both <slot> and ${objectBinding}.children`,
        component,
      );
    }
    if (objectBinding !== null) {
      for (const definition of definitions) {
        if (
          definition.name !== '' &&
          componentReadsGenericProp(component, objectBinding, definition.name)
        ) {
          fail(
            `memo-dom: slot '${definition.name}' conflicts with ${objectBinding}.${definition.name} on '${component.id!.name}'`,
            component,
          );
        }
      }
    }
  }

  // Partition calls while authored `slot="..."` markers and forwarding
  // placeholders are still present, then replace declarations.
  normalizeSlotCalls(
    ctx,
    programPath.node,
    localSlots,
    new Set(topLevelComponents(programPath.node).map((component) => component.id!.name)),
    fail,
  );
  rejectLeftoverSlotMarkers(programPath.node, fail);
  for (const component of topLevelComponents(programPath.node)) {
    const definitions = localSlots.get(component.id!.name);
    if (definitions === undefined) continue;
    rewriteSlotPlaceholders(component, addSlotParameters(component, definitions), fail);
  }
}
