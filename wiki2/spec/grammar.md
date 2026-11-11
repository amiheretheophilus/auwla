# Core grammar

0.1-draft, revision 2. Status: provisional executable-design target.

## Host language and lexical contexts (G-HOST)

The host grammar is the JavaScript/TypeScript/JSX grammar accepted by
compiler-next's existing parser. The separate syntax package uses the same pinned
host parser and adds productions only in the selected
extended format. An implementation MUST tokenize host code with a real host
lexer/parser, preserving comments, escapes, template substitutions, regex goals,
type syntax and balanced delimiters. Counting braces or matching tags with a
regular expression is insufficient.

| Context | Recognizes |
| --- | --- |
| Host code | Existing JS/TS with markup expressions in existing JSX operand positions |
| Opening/closing tags | Existing JSX names/delimiters and attributes, including parenthesized expression values |
| Child body | Child expressions, nested markup, direct conditional blocks and trivia; no raw text token |
| Quoted/template/regex content | Host token rules; markup delimiters inside the token are content |

Format selection MUST be explicit. A quote in an existing TSX child remains JSX
text under TSX rules; it does not opt the file into this grammar.

## Source and ranges (G-SOURCE)

Files are Unicode text, normally UTF-8 on disk. Offsets count UTF-16 code units.
LF, CRLF and CR are host line terminators; CRLF is one line break. Token spelling
and exact ranges are retained, including escapes and non-BMP characters. Trivia
outside string/template tokens does not produce a child.

## Productions (G-CORE)

Notation: quoted tokens are terminals; `?` is optional; `*` is repetition; `|`
separates alternatives. Referenced host/JSX productions retain their existing
meaning. The boundary rules below supplement this grammar.

```ebnf
ExtendedMarkup  ::= Element | Fragment
Element         ::= JSXSelfClosingElement
                  | JSXOpeningElement ChildBody JSXClosingElement
Fragment        ::= "<>" ChildBody "</>"
ChildBody       ::= (Trivia | EmptyChild | ConditionalChild | ExpressionChild)*
EmptyChild      ::= ";"
ConditionalChild ::= "if" "(" HostExpression ")" ChildBlock
                     ("else" (ConditionalChild | ChildBlock))?
ChildBlock      ::= "{" ChildBody "}"
ExpressionChild ::= HostAssignmentExpression ChildEnd
ChildEnd        ::= ";" | HostASI | BodyEnd | AdjacentMarkupBoundary
```

`HostAssignmentExpression` includes literals, arrays, objects, calls, chains,
functions, assignments, templates, ternaries and existing markup primaries. A
comma operator used as one child is parenthesized, as in `<p>(first(), last())</p>`;
commas inside arrays, calls and other nested host constructs are ordinary tokens.

An element/fragment in expression position is still a host primary: it can be
returned, stored, passed, or used inside a function/ternary. Adjacent top-level
markup children get the additional boundary rule below.

## Text and expressions (G-TEXT)

`<p>"Hello"</p>` contains a string-expression child. `<p>message</p>` contains an
identifier-expression child. There is no implicit conversion of bare words into
literal text and no JSX text-entity decoding of a host string.

Single/double-quoted strings and template literals follow host escaping rules.
Quoted source delimiters are not displayed. For example, `"&amp;"` evaluates to
the literal characters `&amp;`, and `"a\nb"` contains a newline.

`//` and `/* ... */` use host comment rules; they are trivia, not children. A
closing tag inside a string, comment, template text or regex token does not close
the element. A line comment continues to its line terminator, including any tag
spelling on that line. HTML comment syntax has no special child-body meaning.

## Expression boundaries (G-BOUNDARY)

1. A semicolon at the child body's current nesting level terminates an expression
   child. It produces no child itself. Semicolons inside a function or string
   have their ordinary host role.
2. Host expression continuation and automatic semicolon insertion apply. A line
   break does not invariably mean a new child. `getValue()` followed by `[index]`
   on the next line is one indexing expression; `value` followed by `+offset` is
   one addition. `first` followed by `second` on a new line is two expressions
   where host ASI would separate them.
3. The enclosing closing tag/fragment or conditional block's `}` supplies a body
   end after a complete expression. Thus `<p>count + 1</p>` needs no semicolon.
   Body-end recognition applies only at the current nesting level and outside
   host tokens. Nested function/object/template delimiters are not body ends.
4. After a complete bare element/fragment child, another opening tag at the same
   child level starts a sibling: `<div><A /><B /></div>`. An ordinary postfix
   continuation belongs to its expression: `<A />.value` is one member expression.
   If an expression starting with markup could be confused with sibling tags,
   parentheses explicitly select the host expression, e.g. `(<A /> < limit)`.
5. A non-markup expression followed by an opening tag MUST have a separator if
   host parsing could join them. Write `"Label"; <input />`, not an assumed
   newline-only break. New tag detection does not rewrite `<` comparisons.
6. A closing-tag token at body depth wins as a delimiter. Parenthesize a host
   expression if its operator/regex spelling would otherwise form that exact
   delimiter. Within parentheses, host tokenization determines the expression.

Examples of the draft rule:

```tsx
<p>"Hello"; " "; user.name</p>
<div>
  "Label";
  <input ref={input} />
</div>
<p>value < limit ? "small" : "large"</p>
<p>(value < /p>/.test(text))</p>
```

This is the first boundary candidate to implement and challenge, not an assertion
that semicolons are required after every child. The fixture catalog includes host
continuation probes and separated equivalents.

## Conditional children (G-IF)

`if` begins a conditional child only at a child-item boundary. Its test is an
ordinary host expression and its bodies MUST be blocks. `else if` associates
with that conditional exactly as in host control flow.

```tsx
<section>
  if (ready) {
    <p>"Ready"</p>
    count + 1
  } else if (failed) {
    <p>"Failed"</p>
  } else {
    <p>"Waiting"</p>
  }
</section>
```

The core child blocks contain child items, not arbitrary statement lists.
Declarations, direct loops and outward `return`/`break`/`continue` inside those
blocks await a later profile. Their behavior MUST NOT be invented through a hidden
function wrapper. Ordinary function expressions inside an expression child have
ordinary host bodies and statements.

## Attributes and existing refs (G-ATTR)

Names, spreads, string attributes, boolean attributes and `prop={expression}`
retain the current JSX grammar and ordering. The extended format also accepts
`prop=(expression)`, where the matching outer parentheses delimit one ordinary
host expression. Nested parentheses, objects, templates, regexes, comparisons,
functions and markup follow host token rules. A comma expression remains grouped
by those parentheses. Empty expressions are invalid.

```auwla
<button aria-label=("Remove " + task.title) onClick=(() => removeTask(task.id))>
  "Remove"
</button>
```

This normalizes to ordinary JSX `prop={(expression)}` and preserves evaluation
order. It does not make a value lazy: `onClick=(handler)` supplies a handler;
`onClick=(() => run())` supplies a callback; `onClick=(run())` evaluates the call
when the attribute value is evaluated, exactly like `onClick={run()}`. TypeScript
checks whether the resulting value is valid for that prop.

`ref={input}` and `ref=(input)` refer to the same normally declared writable
target. Neither declares a binding. No new ref node or `$`-ref syntax is introduced.
Spreads keep `{...props}`; bare `prop=expression` is not added. Existing `.tsx`
retains its existing attribute grammar. Only the extended format adds `=(...)`.

This profile does not define `@event`, modifier chains, `bind:property`, shorthand
classes or special raw CSS blocks. Those remain open design work in
[features.md](../features.md). Ordinary `onClick={handler}` remains available.

## Early errors and recovery (G-ERROR)

Matching element/fragment names, balanced literals/expressions and required `if`
blocks are checked at authored ranges. See [diagnostics.md](diagnostics.md).
Name lookup and type errors follow existing host/tooling rules. A free name may
refer to a global; unknown names/methods do not authorize rejecting valid JS or
treating code as text. A genuinely missing binding keeps its ordinary host error.
Incomplete source may yield recovery nodes for tooling, but
MUST NOT silently become an executable successful parse.
