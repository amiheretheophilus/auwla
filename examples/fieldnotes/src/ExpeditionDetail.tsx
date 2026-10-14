import { redirectRoute, blockNavigation } from '@memoized-dom/router';
import { postNote, deleteNote, getNotes, getExpeditionSummary } from '#server-functions';
import { optimistic } from '@memoized-dom/utils';

export function ExpeditionDetail() {
  // Server-backed preparation: services never ships to the browser — the
  // compiler strips this body and the server runs it. The returned page is
  // what the component reads.
  const page = $routed(async ({ params, services, state }) => {
    const expedition = await services.expeditions.find(params.id);
    if (expedition === null) return redirectRoute('/expeditions');
    return { expedition, viewer: state.visitor };
  });

  const nodes = { noteInput: null as HTMLInputElement | null };
  const notes = getNotes(page.expedition.id);
  const summary = getExpeditionSummary(page.expedition.id);
  let lastPost = null as ReturnType<typeof postNote> | null;
  const deleting = new Set<string>();

  const saveNote = optimistic({
    source: [notes, summary],
    action: (text: string) => postNote(page.expedition.id, text),
    apply(text, operationId) {
      notes.push({ id: operationId, text, by: page.viewer });
      summary.noteCount++;
      return () => {
        const index = notes.findIndex(note => note.id === operationId);
        if (index !== -1) notes.splice(index, 1);
        summary.noteCount--;
      };
    },
    reconcile(saved, _text, operationId) {
      const index = notes.findIndex(note => note.id === operationId);
      if (index !== -1) notes.splice(index, 1, saved);
    },
  });

  const removeSavedNote = optimistic({
    source: [notes, summary],
    action: (noteId: string) => deleteNote(page.expedition.id, noteId),
    apply(noteId) {
      deleting.add(noteId);
      return () => { deleting.delete(noteId); };
    },
    reconcile(_removed, noteId) {
      const index = notes.findIndex(note => note.id === noteId);
      if (index !== -1) { notes.splice(index, 1); summary.noteCount--; }
      deleting.delete(noteId);
    },
  });

  // Leave-guard: block navigation while the note input holds a draft.
  const stopGuard = blockNavigation(() => {
    if (nodes.noteInput !== null && nodes.noteInput.value.trim() !== '') {
      return confirm('Discard your draft note?') ? undefined : false;
    }
  });
  $cleanup(stopGuard);

  function addNote() {
    const input = nodes.noteInput;
    if (input === null || input.value.trim() === '') return;
    const text = input.value;
    input.value = '';

    lastPost = saveNote(text);
  }

  function removeNote(noteId: string) {
    removeSavedNote(noteId);
  }

  return (
    <article>
      <h3>{page.expedition.name}</h3>
      <p class="meta">
        <span class="chip">{page.expedition.region}</span>{' '}
        <span class="chip">{page.expedition.days} days</span>{' '}
        <span class="chip">logged as {page.viewer}</span>
        {' '}<span class="chip" data-note-count>{summary.noteCount} notes</span>
      </p>
      <p class="meta" data-live-status>
        {$track(notes).streaming ? 'Live notes connected' : 'Live notes disconnected'}
      </p>

      <div class="note-form">
        <input
          ref={[nodes.noteInput, (el: HTMLInputElement) => el.focus()]}
          placeholder="Add a field note…"
        />
        <button onClick={addNote}>Add note</button>
      </div>

      {lastPost !== null ? (
        <p class={
          `status-line ${$track(lastPost).pending ? 'pending'
            : $track(lastPost).error !== null ? 'error'
            : 'muted'}`
        }>
          {$track(lastPost).pending
            ? 'Saving note…'
            : $track(lastPost).error !== null
              ? `Note failed: ${$track(lastPost).error?.message}`
              : 'Note saved'}
        </p>
      ) : null}

      <ul class="plain">
        {notes.map(n => (
          <li key={n.id} class="note">
            {n.text} <span class="meta">— {n.by}</span>
            <button
              disabled={deleting.has(n.id)}
              onClick={() => removeNote(n.id)}
            >
              {deleting.has(n.id) ? '…' : '✕'}
            </button>
          </li>
        ))}
      </ul>

      <a class="back" route-to="/expeditions">← All expeditions</a>
    </article>
  );
}
