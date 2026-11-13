import type { IRawGrammar } from 'vscode-textmate';
import { auwlaLanguage } from './registration';

function quotedChild(quote: '"' | "'", name: string): IRawGrammar['patterns'][number] {
  return {
    name,
    begin: quote,
    end: quote,
    beginCaptures: { 0: { name: 'punctuation.definition.string.begin.tsx' } },
    endCaptures: { 0: { name: 'punctuation.definition.string.end.tsx' } },
    patterns: [
      { include: '#string-character-escape' },
      { include: '#auwla-text-interpolation' },
    ],
  };
}

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
  // Use the editor's native CSS grammar. CSS braces never enter the TSX child grammar.
  repository['auwla-style-block'] = {
    begin: '(<)(style)(\\s+global\\s*)(>)',
    beginCaptures: {
      1: { name: 'punctuation.definition.tag.begin.tsx' },
      2: { name: 'entity.name.tag.tsx' },
      3: { name: 'entity.other.attribute-name.tsx' },
      4: { name: 'punctuation.definition.tag.end.tsx' },
    },
    end: '(</)(style)(\\s*>)',
    endCaptures: {
      1: { name: 'punctuation.definition.tag.begin.tsx' },
      2: { name: 'entity.name.tag.tsx' },
      3: { name: 'punctuation.definition.tag.end.tsx' },
    },
    contentName: 'meta.embedded.block.css',
    patterns: [{ include: 'source.css' }],
  };
  grammar.patterns.unshift({ include: '#auwla-style-block' });
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
  repository['auwla-text-interpolation'] = {
    name: 'meta.embedded.expression.auwla',
    begin: '\\{',
    end: '\\}',
    beginCaptures: { 0: { name: 'punctuation.section.embedded.begin.tsx' } },
    endCaptures: { 0: { name: 'punctuation.section.embedded.end.tsx' } },
    patterns: [{ include: '#expression' }],
  };
  repository['auwla-child-block'] = {
    name: 'meta.auwla.child-block',
    begin: '\\{',
    end: '\\}',
    patterns: [{ include: '#auwla-children' }],
  };
  repository['auwla-control'] = {
    begin: '\\b(if|for|else)\\b',
    beginCaptures: { 1: { name: 'keyword.control.tsx' } },
    end: '(?<=\\})',
    patterns: [
      { include: '#comment' },
      { begin: '\\(', end: '\\)', patterns: [{ include: '#expression' }] },
      { include: '#auwla-child-block' },
      { include: '#auwla-control' },
    ],
  };
  repository['auwla-children'] = {
    patterns: [
      quotedChild('"', 'string.quoted.double.tsx'),
      quotedChild("'", 'string.quoted.single.tsx'),
      { include: '#auwla-control' },
      { include: '#statements' },
    ],
  };
  repository['jsx-children'] = { patterns: [{ include: '#auwla-children' }] };
  repository['jsx-tag-attributes'] = { ...attributes, patterns: attributePatterns };
  return {
    ...grammar,
    name: 'Auwla',
    scopeName: auwlaLanguage.scopeName,
    fileTypes: auwlaLanguage.extensions.map((extension) => extension.slice(1)),
  };
}
