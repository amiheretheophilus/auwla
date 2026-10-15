import { expect, it } from 'bun:test';
import { encodePageHtml, decodePageHtml } from '../packages/runtime/src/page-html';
import { isRenderablePage, type PageContent } from '../packages/runtime/src/page-content';

it('transfers rendered HTML directly, with Unicode and safe inert metadata', () => {
  const page: PageContent = { $mmd:'page', version:1, id:'板/😀', html:'<aside>你好 😀 &amp; welcome</aside>',
    binding:{key:'binding',inputs:['</script><img src=x onerror=alert(1)>',undefined],missing:[[1]]},
    styles:['.board::after{content:"</script>"}'] };
  // The encoder receives already JSON-safe inputs from the server projection.
  const wirePage = {...page,binding:{...page.binding!,inputs:[page.binding!.inputs[0],null]}};
  const body = encodePageHtml(wirePage);
  expect(body.startsWith(wirePage.html)).toBe(true);
  expect(body).not.toContain('"html":');
  expect(body.match(/<script/g)).toHaveLength(1);
  expect(body.match(/<\/script>/g)).toHaveLength(1);
  const decoded = decodePageHtml(body);
  expect(decoded).toEqual(wirePage);
  expect(isRenderablePage(decoded)).toBe(false);
});

it('uses the final metadata block without parsing or executing region markup', () => {
  const page: PageContent = {$mmd:'page',version:1,id:'passive',html:'<p>First</p><script type="application/mmd-page+json" data-mmd-page="1">not metadata</script><p>Last</p>'};
  expect(decodePageHtml(encodePageHtml(page))).toEqual(page);
});

it.each([
  '<p>No metadata</p>',
  '<p>Truncated</p><script type="application/mmd-page+json" data-mmd-page="1">{}',
  '<script type="application/mmd-page+json" data-mmd-page="1">null</script>',
  '<script type="application/mmd-page+json" data-mmd-page="1">{"$mmd":"page","version":2,"id":"bad"}</script>',
  '<script type="application/mmd-page+json" data-mmd-page="1">{"$mmd":"page","version":1,"id":"bad","html":"override"}</script>',
])('rejects malformed finite page HTML: %s', body => {
  expect(() => decodePageHtml(body)).toThrow();
});
