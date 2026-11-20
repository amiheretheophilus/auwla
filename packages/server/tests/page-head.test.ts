/**
 * A page's head tags in the HTML the server sends (`src/page-head.ts`): written into the template's
 * head, with the template's tags they override kept where the browser can bring them back.
 */
import { describe, expect, it } from 'bun:test';
import { withPageHead } from '../src/page-head';

const TEMPLATE = '<!doctype html><html><head><meta charset="utf-8"><title>Triaxis</title>'
  + '<meta name="description" content="Signals"><meta name="viewport" content="width=device-width"></head><body><div id="root">';

describe('a page\'s head tags', () => {
  it('replace the template\'s tags for the keys they set, which are kept for the browser', () => {
    const html = withPageHead(TEMPLATE, [
      { key: 'title', html: '<title data-mmd-head>Pricing · Triaxis</title>' },
      { key: 'meta:name:description', html: '<meta name="description" content="Plans" data-mmd-head>' },
    ]);

    expect(html).toBe('<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width">'
      + '<template data-mmd-head-original><title>Triaxis</title><meta name="description" content="Signals"></template>'
      + '<title data-mmd-head>Pricing · Triaxis</title><meta name="description" content="Plans" data-mmd-head>'
      + '</head><body><div id="root">');
  });

  it('add a tag the template does not have, and leave everything else', () => {
    const html = withPageHead(TEMPLATE, [{ key: 'meta:property:og:title', html: '<meta property="og:title" content="Pricing" data-mmd-head>' }]);

    expect(html).toBe(TEMPLATE.replace('</head>', '<meta property="og:title" content="Pricing" data-mmd-head></head>'));
  });

  it('match a meta tag by its whole value, quoted or not', () => {
    const template = '<head><meta name=description content=a><meta name="description-long" content="b"></head>';
    const html = withPageHead(template, [{ key: 'meta:name:description', html: '<meta name="description" content="c" data-mmd-head>' }]);

    expect(html).toBe('<head><meta name="description-long" content="b">'
      + '<template data-mmd-head-original><meta name=description content=a></template>'
      + '<meta name="description" content="c" data-mmd-head></head>');
  });

  it('change nothing for a page with no head tags', () => {
    expect(withPageHead(TEMPLATE, [])).toBe(TEMPLATE);
  });
});
