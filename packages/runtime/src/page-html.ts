/** Finite page wire format: rendered HTML followed by non-executable metadata. */
import { isPageContent, type PageContent } from './page-content';

const METADATA_START = '<script type="application/mmd-page+json" data-mmd-page="1">';
const METADATA_END = '</script>';

export function encodePageHtml(page: PageContent): string {
  const metadata = JSON.stringify({
    $mmd: page.$mmd, version: page.version, id: page.id,
    ...(page.binding ? { binding: page.binding } : {}),
    ...(page.styles?.length ? { styles: page.styles } : {}),
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return page.html + METADATA_START + metadata + METADATA_END;
}

/** Parsing alone does not authorize HTML insertion; the page source validates it. */
export function decodePageHtml(body: string): PageContent {
  const start = body.lastIndexOf(METADATA_START);
  if (start < 0 || !body.endsWith(METADATA_END)) {
    throw new TypeError('memo-dom: missing or incomplete page HTML metadata');
  }
  const metadata: unknown = JSON.parse(body.slice(start + METADATA_START.length, -METADATA_END.length));
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata) || Object.hasOwn(metadata, 'html')) {
    throw new TypeError('memo-dom: invalid page HTML metadata');
  }
  const page = { ...metadata, html: body.slice(0, start) };
  if (!isPageContent(page)) throw new TypeError('memo-dom: invalid page HTML contract');
  return page;
}
