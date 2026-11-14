import type { IRawGrammar } from 'vscode-textmate';
import { auwlaLanguage } from './registration';

const cssIdentifierPart = '(?:[-_[:alnum:]]|[^\\x00-\\x7F]|\\\\(?:[0-9a-fA-F]{1,6}\\s?|.))';

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
    begin: '[ \\t]*(<)(style)((?:\\s+(?:global|id\\s*=\\s*(?:"[^"]*"|\'[^\']*\')))?\\s*)(>)',
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
  // Block rules can begin a zero-width JSX expression on indentation before the
  // tag. Start at that indentation too, but only at a statement boundary. Keep
  // this out of the shared child statements: returned DOM styles remain JSX.
  repository['auwla-style-statement'] = {
    ...repository['auwla-style-block'],
    begin: `(?:^|(?<=[;{}]))${repository['auwla-style-block'].begin}`,
  };
  repository['decl-block']?.patterns?.unshift({ include: '#auwla-style-statement' });
  repository['auwla-css-function'] = {
    name: 'meta.function.auwla-css',
    begin: `(${cssIdentifierPart}+)?(\\()`,
    beginCaptures: {
      1: { name: 'support.function.misc.css' },
      2: { name: 'punctuation.section.function.begin.bracket.round.css' },
    },
    end: '\\)',
    endCaptures: { 0: { name: 'punctuation.section.function.end.bracket.round.css' } },
    patterns: [{ include: '#auwla-css-function' }, { include: 'source.css#property-values' }],
  };
  const injections = {
    ...grammar.injections,
    'L:meta.embedded.block.css meta.property-value.css -string -comment -meta.function': {
      patterns: [{
        name: 'meta.auwla.css-condition',
        match: `(@)(\\.)(${cssIdentifierPart}*)(\\s*:)?`,
        captures: {
          1: { name: 'keyword.control.css' },
          2: { name: 'punctuation.definition.entity.css' },
          3: { name: 'entity.other.attribute-name.class.css' },
          4: { name: 'punctuation.separator.key-value.css' },
        },
      }],
    },
    // Native functions win first. The fallback also protects future/unknown
    // function bodies from interpreting literal @. tokens as class conditions.
    'R:meta.embedded.block.css meta.property-value.css -string -comment -meta.function': {
      patterns: [{ include: '#auwla-css-function' }],
    },
  };
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
    injections,
    name: 'Auwla',
    scopeName: auwlaLanguage.scopeName,
    fileTypes: auwlaLanguage.extensions.map((extension) => extension.slice(1)),
  };
}
