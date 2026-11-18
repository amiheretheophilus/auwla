import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

export interface SharedFrame {
  id: string;
  board: string;
  frame: string;
  labels: string[];
}

const MAX_UPLOAD = 8 * 1024 * 1024;
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function directory(): string {
  return join(process.env.DRAFTROOM_ROOT ?? process.cwd(), '.memoized', 'shares');
}

function validId(id: string): boolean {
  return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
}

async function boundedForm(request: Request): Promise<FormData> {
  const stream = request.body?.getReader();
  const contentType = request.headers.get('content-type');
  if (stream === undefined || !contentType?.startsWith('multipart/form-data;')) {
    throw new Error('Expected a frame upload');
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await stream.read();
    if (part.done) break;

    size += part.value.byteLength;
    if (size > MAX_UPLOAD) {
      await stream.cancel();
      throw new Error('The frame upload exceeds the preview limit');
    }
    chunks.push(part.value);
  }

  const body = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) {
    body.set(chunk, position);
    position += chunk.byteLength;
  }
  return new Response(body, { headers: { 'content-type': contentType } }).formData();
}

function title(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || value.trim() === '' || value.length > 120) {
    throw new Error('Invalid frame title');
  }
  return value.trim();
}

async function readImage(form: FormData): Promise<Uint8Array> {
  const image = form.get('image');
  if (!(image instanceof File) || image.type !== 'image/png' || image.size < 24) {
    throw new Error('A PNG image is required');
  }

  const bytes = new Uint8Array(await image.arrayBuffer());
  const header = new DataView(bytes.buffer);
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte)
    || header.getUint32(12) !== 0x49484452 || header.getUint32(16) > 4096 || header.getUint32(20) > 4096) {
    throw new Error('Invalid frame image');
  }
  return bytes;
}

export async function saveShare(request: Request): Promise<SharedFrame> {
  const form = await boundedForm(request);
  const labelsValue = form.get('labels');
  const labels: unknown = typeof labelsValue === 'string' ? JSON.parse(labelsValue) : [];
  if (!Array.isArray(labels) || labels.length > 1000 || !labels.every(label => typeof label === 'string' && label.length <= 1000)) {
    throw new Error('Invalid frame text');
  }

  const entry = { id: crypto.randomUUID(), board: title(form, 'board'), frame: title(form, 'frame'), labels };
  const bytes = await readImage(form);
  const root = directory();
  await mkdir(root, { recursive: true });
  // The metadata makes the link visible only after the complete image is on disk.
  await writeFile(join(root, `${entry.id}.png`), bytes, { flag: 'wx' });
  await writeFile(join(root, `${entry.id}.json`), JSON.stringify(entry), { flag: 'wx' });
  return entry;
}

export async function loadShare(id: string): Promise<SharedFrame | undefined> {
  if (!validId(id)) return undefined;
  return readFile(join(directory(), `${id}.json`), 'utf8').then(text => JSON.parse(text) as SharedFrame, () => undefined);
}

export async function loadSharedImage(id: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (!validId(id)) return undefined;
  return readFile(join(directory(), `${id}.png`)).then(bytes => new Uint8Array(bytes), () => undefined);
}
