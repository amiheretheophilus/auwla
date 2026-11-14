/** A lazy route's styles linked in the head of a page the server renders (`src/route-styles.ts`). */
import { describe, expect, it } from 'bun:test';
import { withRouteStyles } from '../src/route-styles';

const styles = {
  './Profile.tsx#Profile': ['/assets/Profile.css', '/assets/shared.css'],
  './Admin.tsx#Admin': ['/assets/shared.css', '/assets/Admin.css'],
};

describe('withRouteStyles', () => {
  it('links the styles of the rendered route components before the head closes', () => {
    const prefix = '<html><head><title>x</title></head><body><div id="root">';
    expect(withRouteStyles(prefix, ['./Profile.tsx#Profile'], styles)).toBe(
      '<html><head><title>x</title><link rel="stylesheet" href="/assets/Profile.css">'
      + '<link rel="stylesheet" href="/assets/shared.css"></head><body><div id="root">',
    );
  });

  it('links a stylesheet two routes share once, and none the document links already', () => {
    const prefix = '<head><link rel="stylesheet" href="/assets/Admin.css"></head><body>';
    const linked = withRouteStyles(prefix, ['./Profile.tsx#Profile', './Admin.tsx#Admin'], styles);
    expect(linked.match(/shared\.css/g)).toHaveLength(1);
    expect(linked.match(/Admin\.css/g)).toHaveLength(1);
  });

  it('leaves the document alone with no styles, no rendered split routes, or unknown keys', () => {
    const prefix = '<head></head><body>';
    expect(withRouteStyles(prefix, ['./Profile.tsx#Profile'], undefined)).toBe(prefix);
    expect(withRouteStyles(prefix, [], styles)).toBe(prefix);
    expect(withRouteStyles(prefix, ['./Other.tsx#Other'], styles)).toBe(prefix);
  });

  it('puts the links before the outlet when the template has no head', () => {
    expect(withRouteStyles('<body><div id="root">', ['./Profile.tsx#Profile'], { './Profile.tsx#Profile': ['/a.css'] }))
      .toBe('<body><div id="root"><link rel="stylesheet" href="/a.css">');
  });

  it('escapes the URL as an attribute', () => {
    expect(withRouteStyles('<head></head>', ['k'], { k: ['/a.css?x="1"&y'] }))
      .toBe('<head><link rel="stylesheet" href="/a.css?x=&quot;1&quot;&amp;y"></head>');
  });
});
