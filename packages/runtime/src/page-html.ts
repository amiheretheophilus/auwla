/** Finite page wire format: rendered HTML followed by non-executable metadata. */
import { isPageContent, type PageContent } from './page-content';

const METADATA_START = '<script type="application/mmd-page+json" data-mmd-page="1">';
const METADATA_END = '</script>';

export function encodePageHtml(page: PageContent): string {
  const metadata = JSON.stringify({
    $mmd: page.$mmd, version: page.version, id: page.id,
    ...(page.binding ? { binding: page.binding } : {}),
    ...(page.styles?.length ? { styles: page.styles } : {}),
    ...(page.progress ? { progress: page.progress } : {}),
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return page.html + METADATA_START + metadata + METADATA_END;
}

const FRAME = /^<!--mmd:page-(value|error):(\d+)-->/;
const MAX_FRAME = 1_048_576;

/** Inert HTML framing. Exact UTF-16 lengths avoid delimiter/markup collisions. */
export function encodePageFrame(page: PageContent): string {
  const body = encodePageHtml(page);
  if (body.length > MAX_FRAME) throw new Error('memo-dom: server page frame exceeds its limit');
  return `<!--mmd:page-value:${body.length}-->${body}`;
}
export function encodePageFailure(): string {
  const message = 'Server page failed';
  return `<!--mmd:page-error:${message.length}-->${message}`;
}

/** A finite page uses one HTML response, never executable stream scripts. */
export async function* decodePageFrames(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<PageContent> {
  const reader = body.getReader(), decoder = new TextDecoder();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  let buffer = '', final = false, seen = false, generation: string | undefined, sequence = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      while (buffer.length > 0) {
        const frame = FRAME.exec(buffer);
        if (!frame) {
          if (buffer.length > 64 || next.done) throw new Error('memo-dom: invalid server page frame');
          break;
        }
        const length = Number(frame[2]);
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_FRAME) throw new Error('memo-dom: invalid server page frame length');
        if (buffer.length < frame[0].length + length) break;
        if (final) throw new Error('memo-dom: frame after server page completion');
        const payload = buffer.slice(frame[0].length, frame[0].length + length);
        buffer = buffer.slice(frame[0].length + length);
        if (frame[1] === 'error') throw new Error('Server page failed');
        const page = decodePageHtml(payload);
        if (page.progress) {
          if (generation !== undefined && generation !== page.progress.id || page.progress.sequence !== sequence + 1) {
            throw new Error('memo-dom: invalid server page progression');
          }
          generation = page.progress.id; sequence = page.progress.sequence;
        } else if (seen) throw new Error('memo-dom: missing server page progression');
        final = page.progress?.complete ?? true; seen = true;
        yield page;
      }
      if (next.done) break;
    }
    signal?.throwIfAborted();
    if (buffer || !seen || !final) throw new Error('memo-dom: incomplete server page response');
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
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
