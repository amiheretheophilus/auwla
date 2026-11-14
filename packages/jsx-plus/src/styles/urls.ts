import { ident, string, tokenize, tokenTypes as T, url } from 'css-tree';

function segments(path: string): string[] {
  const result: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..' && result.length > 0 && result.at(-1) !== '..') {
      result.pop();
    } else {
      result.push(part);
    }
  }
  return result;
}

function directory(path: string): string {
  const slashes = path.replaceAll('\\', '/');
  return slashes.slice(0, slashes.lastIndexOf('/') + 1);
}

/** Move relative CSS resources with their defining rules, without reading assets. */
export function rebaseStyleUrls(source: string, definition: string, consumer: string): string {
  if (directory(definition) === directory(consumer)) {
    return source;
  }

  function rebase(value: string): string {
    if (value === '' || /^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(value)) {
      return value;
    }
    const suffixAt = value.search(/[?#]/);
    const path = suffixAt < 0 ? value : value.slice(0, suffixAt);
    const suffix = suffixAt < 0 ? '' : value.slice(suffixAt);
    const from = segments(directory(consumer));
    const to = segments(directory(definition) + path);
    while (from.length > 0 && from[0] === to[0]) {
      from.shift();
      to.shift();
    }
    const relative = [...from.map(() => '..'), ...to].join('/');
    return (relative.startsWith('..') ? relative : './' + relative) + (path.endsWith('/') ? '/' : '') + suffix;
  }

  const tokens: { type: number; start: number; end: number }[] = [];
  tokenize(source, (type, start, end) => tokens.push({ type, start, end }));
  const edits: { start: number; end: number; text: string }[] = [];
  const closes: number[] = [];
  function nextSignificant(index: number) {
    for (index++; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (token.type !== T.WhiteSpace && token.type !== T.Comment) return token;
    }
    return undefined;
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const raw = source.slice(token.start, token.end);
    if (token.type === closes.at(-1)) {
      closes.pop();
    }
    if (token.type === T.Url) {
      const value = url.decode(raw);
      const target = rebase(value);
      if (target !== value) {
        edits.push({ ...token, text: `url(${string.encode(target)})` });
      }
      continue;
    }
    const quotedUrl = token.type === T.Function && ident.decode(raw.slice(0, -1)).toLowerCase() === 'url';
    const imported = closes.length === 0 && token.type === T.AtKeyword && ident.decode(raw.slice(1)).toLowerCase() === 'import';
    if (quotedUrl || imported) {
      const valueToken = nextSignificant(index);
      if (valueToken?.type === T.String) {
        const authored = source.slice(valueToken.start, valueToken.end);
        const value = string.decode(authored);
        const target = rebase(value);
        if (target !== value) {
          edits.push({ ...valueToken, text: string.encode(target, authored[0] === "'") });
        }
      }
    }
    if (token.type === T.Function || token.type === T.LeftParenthesis) {
      closes.push(T.RightParenthesis);
    } else if (token.type === T.LeftSquareBracket) {
      closes.push(T.RightSquareBracket);
    } else if (token.type === T.LeftCurlyBracket) {
      closes.push(T.RightCurlyBracket);
    }
  }

  let result = '';
  let position = 0;
  for (const edit of edits) {
    result += source.slice(position, edit.start) + edit.text;
    position = edit.end;
  }
  return result + source.slice(position);
}
