import { expect, it } from 'bun:test';
import { sourceSection, traceTitle, traceView } from '../src/presentation';
import { diagnostic } from '../src/protocol';

const code = '  <main>\n    <button onClick={() => count++}>{count}</button>\n  </main>';
const location = { file: './src/App.tsx', component: 'App', sectionLine: 30, line: 31, column: 13,
  code, highlightStart: code.indexOf('onClick'), highlightEnd: code.indexOf('}>{count}') + 1 };
it('shows a whole escaped JSX section with real file lines and the exact highlighted handler', () => {
  const html = sourceSection(location);
  expect(html).toContain('App'); expect(html).toContain('./src/App.tsx:31:13');
  expect(html).toContain('&lt;main&gt;'); expect(html).toContain('&lt;/main&gt;');
  expect(html).toContain('<mark>onClick={() =&gt; count++}</mark>');
  expect(html).toContain('>30</span>'); expect(html).toContain('>32</span>');
  expect(html).not.toContain('<button onClick');
});
it('escapes untrusted labels and multiline code without changing the highlight offsets', () => {
  const value = '<script>\nalert("x")\n</script>';
  const html = sourceSection({ ...location, component: '<img src=x>', file: '<svg>', code: value, highlightStart: 3, highlightEnd: value.length });
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).not.toContain('<svg>');
  expect(html.match(/class="source-line selected"/g)).toHaveLength(3);
});
it('uses action labels instead of protocol terminology', () => {
  expect(traceTitle(diagnostic('trace', 'event-started', { type: 'onClick' }, 'browser')!)).toBe('Click handler ran');
  expect(traceTitle(diagnostic('trace', 'dom-write', { operation: 'text' }, 'browser')!)).toBe('Text updated');
});
it('preserves Unicode/CRLF span offsets without inserting extra display lines', () => {
  const value = '<main>😀\r\n  {count}\r\n</main>';
  const start = value.indexOf('count');
  const html = sourceSection({ ...location, code: value, highlightStart: start, highlightEnd: start + 5 });
  expect(html).not.toContain('\r'); expect(html).toContain('<mark>count</mark>');
  expect(html.match(/class="source-line/g)).toHaveLength(3);
});
it('separates events, compiler-labelled conditions and ordinary reactivity without guessing owner names', () => {
  expect(traceView(diagnostic('trace', 'event-returned', {}, 'browser')!)).toBe('events');
  expect(traceView(diagnostic('trace', 'update-completed', { kind: 'conditional' }, 'browser')!)).toBe('regions');
  expect(traceView(diagnostic('trace', 'update-completed', { component: 'App/when0' }, 'browser')!)).toBe('reactivity');
  expect(traceView(diagnostic('trace', 'dom-write', { operation: 'text' }, 'browser')!)).toBe('reactivity');
});
