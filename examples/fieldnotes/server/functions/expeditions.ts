import { delay } from '#server/latency';
import { define } from '../define';

export const getExpeditions = define.function({
  async get({ services }) {
    await delay(900);
    return services.expeditions.all().map(e => ({
      id: e.id,
      name: e.name,
      region: e.region,
      days: e.days,
      notes: e.notes.length,
    }));
  },
});

export const postNote = define.function({
  async post({ state, services }, expeditionId: string, text: string) {
    if (text.trim() === '') {
      throw new Error('Note text cannot be empty');
    }
    if (text.toLowerCase().includes('spam')) {
      throw new Error('Note rejected by content filter');
    }
    await delay(1500);
    return services.notes.add(expeditionId, text, state.visitor);
  },
});

export const deleteNote = define.function({
  async delete({ services }, expeditionId: string, noteId: string) {
    await delay(700);
    const removed = services.notes.remove(expeditionId, noteId);
    if (removed === null) {
      throw new Error('Unknown note');
    }
    return removed;
  },
});
