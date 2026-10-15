export function Board({ boardId, title, count, renderId }: {
  boardId: string;
  title: string;
  count: number;
  renderId: number;
}) {
  let localClicks = 0;

  async function clickLocally() {
    await Promise.resolve();
    localClicks++;
  }

  return (
    <section class="board" data-board={boardId}>
      <div class="board-heading">
        <h2>{title}</h2>
        <span class="badge">Live region</span>
      </div>
      <p class="count" data-count={boardId}>{count}</p>
      <p class="muted">Server render <strong data-render={boardId}>#{renderId}</strong></p>
      <div class="local-area">
        <span class="eyebrow">Local interaction inside server UI</span>
        <button data-local={boardId} onClick={clickLocally}>Local clicks: {localClicks}</button>
        <label>
          Unsubmitted input
          <input data-draft={boardId} value="" placeholder="Type here, then update the server" />
        </label>
        <p class="muted">These stay in this tab when this live region updates.</p>
      </div>
    </section>
  );
}
