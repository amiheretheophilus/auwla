/** The lexical activation retaining a declaration's native storage. */
import { is } from 'yuku-ast';
import type { Node } from 'yuku-parser';
import type { BindingNode } from '../graph';
import { variableDeclaration } from '../graph/inputs';

export function storageOwner(binding: BindingNode): Node | null {
  const runner = binding.owner.runner;
  const declarator = variableDeclaration(binding.binding);
  if (declarator === null) {
    return runner;
  }
  const module = binding.binding.module;
  const declaration = module.parentOf(declarator);
  // `var` belongs to the function activation even when declared inside a block.
  // Lexical declarations need the particular block activation that created them.
  if (!is.VariableDeclaration(declaration) || declaration.kind === 'var') {
    return runner;
  }
  const parent = module.parentOf(declaration);
  if (is.BlockStatement(parent) && (!is.Function(runner) || parent !== runner.body)) {
    return parent;
  }
  return runner;
}
