import type { IRawGrammar } from 'vscode-textmate';
import { auwlaLanguage } from './registration';

/**
 * Derive a standalone TextMate grammar from the pinned TSX grammar. Replacing
 * the child rule lets the existing lexer own strings, comments and nested tags;
 * injecting expression rules inside those lexical states would break closers.
 * No editor SDK is needed to build or consume the resulting JSON grammar.
 */
export function createAuwlaGrammar(tsx: IRawGrammar): IRawGrammar {
  const grammar = structuredClone(tsx);
  const repository = grammar.repository;
  if (!repository?.['jsx-children'] || !repository['jsx-tag-attributes']) {
    throw new Error('The TSX grammar does not expose the expected child and attribute rules');
  }

  const attributes = repository['jsx-tag-attributes'];
  const attributePatterns = [
    {
      begin: '(=)\\s*(\\()',
      beginCaptures: {
        1: { name: 'keyword.operator.assignment.tsx' },
        2: { name: 'meta.brace.round.tsx' },
      },
      end: '\\)',
      endCaptures: { 0: { name: 'meta.brace.round.tsx' } },
      contentName: 'meta.embedded.expression.auwla',
      patterns: [{ include: '#expression' }],
    },
    {
      match: '(=)\\s*([_$[:alpha:]][_$[:alnum:]]*)(?=\\s|/?>)',
      captures: {
        1: { name: 'keyword.operator.assignment.tsx' },
        2: { name: 'variable.other.readwrite.tsx' },
      },
    },
    ...(attributes.patterns ?? []),
  ];
  repository['jsx-children'] = { patterns: [{ include: '#statements' }] };
  repository['jsx-tag-attributes'] = { ...attributes, patterns: attributePatterns };
  return {
    ...grammar,
    name: 'Auwla',
    scopeName: auwlaLanguage.scopeName,
    fileTypes: auwlaLanguage.extensions.map((extension) => extension.slice(1)),
  };
}
