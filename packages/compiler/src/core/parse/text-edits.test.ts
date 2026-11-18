import { describe, expect, it } from 'bun:test';
import { applyEdits, applyEditsWithOrigin, composeOrigins, TracedText, type Edit } from './text-edits';

const SOURCE = 'const answer: number = 42;\nexport { answer };\n';

describe('traced text', () => {
  it('gives the text applyEdits gives, insertions at one place in order', () => {
    const edits: Edit[] = [
      { start: 12, end: 20, text: '' },
      { start: 0, end: 0, text: 'first;\n' },
      { start: 0, end: 0, text: 'second;\n' },
      { start: 27, end: 27, text: '/* here */' },
      { start: 0, end: 5, text: 'let' },
    ];
    expect(applyEditsWithOrigin(SOURCE, edits).text).toBe(applyEdits(SOURCE, edits));
  });

  it('maps kept text offset for offset, and written text to where it was put', () => {
    const edits: Edit[] = [{ start: 12, end: 20, text: '' }, { start: 0, end: 0, text: 'pre;' }];
    const { text, origin } = applyEditsWithOrigin(SOURCE, edits);
    expect(text).toBe('pre;const answer = 42;\nexport { answer };\n');
    expect(origin.original(text.indexOf('answer'))).toBe(SOURCE.indexOf('answer'));
    expect(origin.original(text.indexOf('42'))).toBe(SOURCE.indexOf('42'));
    expect(origin.original(text.indexOf('export'))).toBe(SOURCE.indexOf('export'));
    expect(origin.original(1)).toBe(0);
  });

  it('keeps the places of authored text an edit moves', () => {
    // Move `42` to the front, wrapped: the moved digits still map to where they were written.
    const at = SOURCE.indexOf('42');
    const moved = TracedText.join(['(', TracedText.kept(SOURCE, at, at + 2), ')']);
    const { text, origin } = applyEditsWithOrigin(SOURCE, [
      { start: 0, end: 0, text: moved.text, traced: moved },
      { start: at, end: at + 2, text: '0' },
    ]);
    expect(text.startsWith('(42)')).toBe(true);
    expect(origin.original(1)).toBe(at);
    expect(origin.original(2)).toBe(at + 1);
    expect(origin.original(0)).toBe(0);
  });

  it('applies edits inside a piece, as a moved child with its own lowering', () => {
    const start = SOURCE.indexOf('export');
    const end = SOURCE.length;
    const traced = TracedText.edited(SOURCE, [{ start: start + 9, end: start + 9, text: 'x, ' }], start, end);
    expect(traced.text).toBe('export { x, answer };\n');
    expect(traced.origin.original(traced.text.indexOf('answer'))).toBe(SOURCE.lastIndexOf('answer'));
    expect(traced.origin.original(traced.text.indexOf('x,'))).toBe(start + 9);
  });

  it('slices with the places of what is left', () => {
    const traced = TracedText.join(['{', TracedText.kept(SOURCE, 6, 12), '}']).slice(1, 7);
    expect(traced.text).toBe('answer');
    expect(traced.origin.original(0)).toBe(6);
    expect(traced.origin.original(5)).toBe(11);
  });

  it('composes the origins of edits made one after another', () => {
    const first = applyEditsWithOrigin(SOURCE, [{ start: 0, end: 0, text: '// one\n' }]);
    const second = applyEditsWithOrigin(first.text, [{ start: 0, end: 0, text: '// two\n' }]);
    const origin = composeOrigins(second.origin, first.origin);
    expect(origin.original(second.text.indexOf('answer'))).toBe(SOURCE.indexOf('answer'));
  });
});
