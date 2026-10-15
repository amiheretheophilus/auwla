import { Group } from '@memoized-dom/data';
import { getBoardSummary, getBoardActivity } from '#server-functions';

function Loading() {
  return <span class="status">Loading this section…</span>;
}

export function ProgressiveBoard({ boardId }: { boardId: string }) {
  const summary = getBoardSummary(boardId);
  const activity = getBoardActivity(boardId);

  return (
    <section class="board" data-progressive>
      <h2>Ready sections do not wait for slower ones.</h2>
      <p>This heading and input arrive first. The summary takes 400 ms; activity takes 1.6 seconds.</p>
      <label>Try typing while the sections load <input data-progressive-draft placeholder="Your draft stays here" /></label>
      <div class="boards">
        <Group pending={Loading}><article><h3>Summary</h3><p>{summary.title}: {summary.count}</p></article></Group>
        <Group pending={Loading}><article><h3>Activity</h3><p>{activity.message}</p></article></Group>
      </div>
    </section>
  );
}
