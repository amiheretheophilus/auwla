import { expect, it } from 'bun:test';
import { walk, type CssNode } from 'css-tree';
import { parseStylesheet } from '../src/styles/syntax';
import { normalize } from '../src';
import { createCssSession } from '../src/styles/tooling';

it('distinguishes native rules from surrounding declarations and custom-property token blocks', () => {
  const source = `.card {
    color:red;
    .title {color:teal}
    h2:hover {color:navy}
    --tokens:{nested:tokens};
    --x/**/: {a:b};
    background:paint(swatch, {nested:tokens});
    content:"literal { .not-a-rule }";
    color:green;
  }`;
  const rules: string[] = [];
  const declarations: string[] = [];
  const tree = parseStylesheet(source, { positions: true, parseValue: false, parseCustomProperty: false });
  walk(tree, { enter(node: CssNode) {
    if (node.type === 'Rule') rules.push(source.slice(node.prelude.loc!.start.offset, node.prelude.loc!.end.offset));
    if (node.type === 'Declaration') declarations.push(node.property);
  } });
  expect(rules).toEqual(['.card', '.title', 'h2:hover']);
  expect(declarations).toEqual(['color', 'color', 'color', '--tokens', '--x', 'background', 'content', 'color']);
  const css = normalize(`<style>${source}</style>`).stylesheet!;
  expect(css).toContain('--tokens:{nested:tokens}');
  expect(css).toContain('content:"literal { .not-a-rule }"');
});

it('retains escaped identifiers, relative selectors and grouping contexts with class conditions', () => {
  const source = String.raw`<style>
  .card {
    @media (min-width:1px) {
      color:red;
      h2:hover, > .\74 itle {color:navy @.loading:teal;}
      color:green;
    }
    :is(h2, h3) {font-weight:bold;}
  }
  </style>`;
  const result = normalize(source).stylesheet!;
  expect(result).not.toContain('@.');
  expect(result).toContain('h2:hover:where(');
  expect(result).toContain('.loading');
  expect(createCssSession(source, 'file:///App.auwla')!.diagnostics()).toEqual([]);
  expect(createCssSession(`<style global>${result}</style>`, 'file:///App.auwla')!.diagnostics()).toEqual([]);
});

it('retains bounded recovery for incomplete native CSS during editing', () => {
  for (const css of ['.a { ) }', '.a{color:fn( }', '.a{ [bad }', '.a{ @media ( }', '.a{color:}', '.a{.b']) {
    expect(() => parseStylesheet(css, { positions: true, parseValue: false })).not.toThrow();
    expect(() => createCssSession(`<style global>${css}</style>`, 'file:///App.auwla')).not.toThrow();
  }
});
