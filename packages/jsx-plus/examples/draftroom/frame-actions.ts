import { imageOf } from './canvas/paint';
import { download } from './model/files';
import { frameContents } from './model/frames';
import type { Page, PresentationView, Shape } from './model/types';

function capture(page: Page, frame: Shape): Promise<Blob> {
  const canvas = imageOf([frame, ...frameContents(page, frame)], frame);
  return new Promise((resolve, reject) => {
    if (canvas === undefined) {
      reject(new Error('This frame cannot be captured'));
      return;
    }

    canvas.toBlob(blob => {
      canvas.width = 0;
      canvas.height = 0;
      if (blob === null) {
        reject(new Error('Could not encode the frame'));
      } else {
        resolve(blob);
      }
    }, 'image/png');
  });
}

export function createFrameActions(page: () => Page, say: (status: string) => void, publish: () => void) {
  let shown: PresentationView | undefined;
  let presenting: string | undefined;
  let generation = 0;
  let shareUrl: string | undefined;
  let shareFrameId: string | undefined;
  let sharing = false;

  function present(frame: Shape): void {
    const current = page();
    const frames = current.shapes.filter(shape => shape.kind === 'frame' && !shape.hidden);
    const index = frames.findIndex(shape => shape.id === frame.id);
    if (index < 0) return;

    const request = ++generation;
    presenting = frame.id;
    void capture(current, frame).then(blob => {
      if (generation !== request) return;

      if (shown !== undefined) URL.revokeObjectURL(shown.url);
      shown = { title: frame.title, url: URL.createObjectURL(blob), index, total: frames.length };
      publish();
    }, () => say('Could not open the frame presentation'));
  }

  function next(offset: number): void {
    const frames = page().shapes.filter(shape => shape.kind === 'frame' && !shape.hidden);
    const index = frames.findIndex(frame => frame.id === presenting);
    const frame = frames[index + offset];
    if (index >= 0 && frame !== undefined) present(frame);
  }

  function close(): void {
    generation += 1;
    presenting = undefined;
    if (shown !== undefined) {
      URL.revokeObjectURL(shown.url);
      shown = undefined;
      publish();
    }
  }

  function exportFrame(frame: Shape): void {
    const filename = frame.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'frame';
    void capture(page(), frame).then(blob => {
      download(blob, `${filename}.png`);
      say('Frame exported');
    }, () => say('Could not export the frame'));
  }

  async function postFrame(current: Page, frame: Shape): Promise<string> {
    const labels = frameContents(current, frame).filter(shape => shape.text.trim() !== '').map(shape => shape.text);
    const form = new FormData();
    form.set('board', current.name);
    form.set('frame', frame.title);
    form.set('labels', JSON.stringify(labels));
    form.set('image', await capture(current, frame), 'frame.png');

    const response = await fetch('/api/shared-frames', { method: 'POST', body: form });
    if (!response.ok) throw new Error('Could not create the view link');

    const result = await response.json() as { path?: string };
    if (result.path === undefined || !/^\/share\/[a-f0-9-]{36}$/.test(result.path)) {
      throw new Error('The share endpoint returned an invalid link');
    }
    return new URL(result.path, location.origin).href;
  }

  function share(frame: Shape): void {
    if (sharing) return;

    sharing = true;
    shareUrl = undefined;
    shareFrameId = frame.id;
    say('Creating read-only link…');
    void postFrame(page(), frame).then(url => {
      sharing = false;
      shareUrl = url;
      say('Read-only link ready');
    }, () => {
      sharing = false;
      say('Could not create a read-only link');
    });
  }

  function copyLink(): void {
    if (shareUrl === undefined || navigator.clipboard === undefined) return;
    void navigator.clipboard.writeText(shareUrl).then(() => say('Link copied'), () => say('Select the link to copy it'));
  }

  return {
    present, next, close, export: exportFrame, share, copyLink,
    presentation: () => shown,
    link: () => shareUrl,
    linkFrame: () => shareFrameId,
    sharing: () => sharing,
  };
}
