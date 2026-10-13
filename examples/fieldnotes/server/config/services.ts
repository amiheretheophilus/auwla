import { createStore } from './store';
import {
  createExpeditionService,
  type ExpeditionService,
} from './expeditions';
import { createNoteService, type NoteService } from './notes';
import { define } from '../define';

/** Declare the service graph once. Dependencies are resolved lazily by serve(). */
export const store = define.service('store', createStore);

export const expeditions = define.service('expeditions', {
  dependencies: { store },
  create: ({ store }): ExpeditionService => createExpeditionService(store),
});

export const notes = define.service('notes', {
  dependencies: { store },
  create: ({ store }): NoteService => createNoteService(store),
});
