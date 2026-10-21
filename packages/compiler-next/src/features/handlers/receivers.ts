/** Receiver and private writes retain class lexical access and native targets. */
import { b, is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { Module } from '../../core/resolve';
import type { Names } from '../../core/emit/names';
import { copy } from '../../core/emit/copy';
import { expression, stringLiteral } from '../../core/emit/quote';

export function planReceiverTargets(module: Module): readonly Node[] {
  return module.findAll('MemberExpression').filter((member) => {
    let root: Node = member.object;
    while (is.MemberExpression(root)) root = root.object;
    if (!is.ThisExpression(root) && !is.Super(root) && !is.PrivateIdentifier(member.property)) return false;
    let child: Node = member;
    let parent = module.parentOf(child);
    while (parent !== null) {
      if (is.AssignmentExpression(parent)) return parent.left === child;
      if (is.UpdateExpression(parent)) return parent.argument === child;
      if (is.ForOfStatement(parent) || is.ForInStatement(parent)) return parent.left === child;
      if (is.UnaryExpression(parent)) return parent.operator === 'delete' && parent.argument === child;
      if (!is.Property(parent) && !is.ArrayPattern(parent) && !is.ObjectPattern(parent)
        && !is.AssignmentPattern(parent) && !is.RestElement(parent) && !is.ParenthesizedExpression(parent)) return false;
      child = parent;
      parent = module.parentOf(child);
    }
    return false;
  });
}

export function emitReceiverTargets(targets: readonly Node[], module: Module, names: Names, runtime: string) {
  const replacements = new Map<Node, Node>();
  for (const original of [...targets].sort((a, b) => (a.end - a.start) - (b.end - b.start))) {
    if (!is.MemberExpression(original)) continue;
    const member = copy(original, replacements);
    const parent = module.parentOf(original);
    const key = member.computed ? member.property : stringLiteral((member.property as { name: string }).name);
    if (is.UnaryExpression(parent) && parent.operator === 'delete') {
      replacements.set(parent, expression('$$runtime.deleteMutation($$object, $$key, () => {})', {
        runtime, object: member.object, key,
      }));
    } else if (is.PrivateIdentifier(member.property) || is.Super(member.object)) {
      const value = names.fresh('_assigned');
      if (is.Super(member.object)) {
        replacements.set(original, expression('$$runtime.receiverMutationTarget(() => $$member, $$value => $$member = $$value, this).value', {
          runtime, member, value,
        }));
      } else {
        const object = names.fresh('_receiver');
        const target = { ...member, object: b.Identifier({ name: object }) };
        replacements.set(original, expression('($$object => $$runtime.receiverMutationTarget(() => $$target, $$value => $$target = $$value, $$object))($$receiver).value', {
          object, runtime, target, value, receiver: member.object,
        }));
      }
    } else {
      replacements.set(original, expression('$$runtime.mutationTarget($$object, $$key, () => {}).value', {
        runtime, object: member.object, key,
      }));
    }
  }
  return replacements;
}
