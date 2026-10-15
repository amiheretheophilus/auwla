import { Group } from '@memoized-dom/data';
import type { ErrorPolicyComponentProps } from '@memoized-dom/data';
import { changeCount, getBoard, getReceipt, renameOrchard, getProgressiveBoard } from '#server-functions';

function Loading() {
  return <p class="status">Waiting for server UI…</p>;
}

function Failed({ error, retry }: ErrorPolicyComponentProps) {
  return <p class="error">{error.message} <button onClick={retry}>Retry</button></p>;
}

export function App() {
  let shellClicks = 0;
  const orchard = getBoard('orchard');
  const harbor = getBoard('harbor');
  let receipt = getReceipt();
  const progressive = getProgressiveBoard('orchard');

  const rename = $forms((fields: FormData) => {
    const result = renameOrchard(String(fields.get('title') ?? ''));
    receipt = result;
    return result;
  });

  return (
    <main class="app">
      <header>
        <p class="eyebrow">Memoized DOM / server-owned UI</p>
        <h1>A page can be a region.</h1>
        <p class="intro">Two live boards. One finite action. No document refresh.</p>
        <button class="shell-counter" data-shell onClick={() => shellClicks++}>
          App-shell local clicks: {shellClicks}
        </button>
      </header>

      <aside class="instructions">
        <strong>Try this in two tabs</strong>
        <p>Click a local counter and type into its input. Update that board from the other tab.
          Its server count changes; your local clicks, typed value, and focus stay put.
          The other board and app-shell counter stay untouched.</p>
      </aside>

      <div class="boards">
        <div>
          <Group pending={Loading} error={Failed}><div suspend>{orchard}</div></Group>
          <div class="actions">
            <button data-change="orchard-minus" onClick={() => changeCount('orchard', -1)}>Orchard −1</button>
            <button data-change="orchard-plus" onClick={() => changeCount('orchard', 1)}>Orchard +1</button>
          </div>
        </div>
        <div>
          <Group pending={Loading} error={Failed}><div suspend>{harbor}</div></Group>
          <div class="actions">
            <button data-change="harbor-minus" onClick={() => changeCount('harbor', -1)}>Harbor −1</button>
            <button data-change="harbor-plus" onClick={() => changeCount('harbor', 1)}>Harbor +1</button>
          </div>
        </div>
      </div>

      <section class="finite">
        <div>
          <p class="eyebrow">An ordinary POST can return UI too</p>
          <h2>Rename Orchard</h2>
          <p>The returned receipt replaces only the region beside this form.
            The matching live boards update independently, including in another tab.</p>
          <form onSubmit={rename.submit}>
            <label>New title <input name="title" required maxLength={60} placeholder="e.g. Evening orchard" /></label>
            <button data-rename disabled={rename.pending}>{rename.pending ? 'Saving…' : 'Save title'}</button>
          </form>
        </div>
        <Group pending={Loading} error={Failed}><div suspend>{receipt}</div></Group>
      </section>

      <section>
        <h2>Colorless progressive delivery</h2>
        <p>On first load, the static region appears before its data. Repeating it keeps the previous completed result visible.</p>
        <button data-progressive-reload onClick={() => $track(progressive).refresh()}>Load a new result</button>
        <Group pending={Loading} error={Failed}>{progressive}</Group>
      </section>

      <footer>Demo state lives in this server process. Restarting resets it.
        Render numbers are per-board, shared across viewers—not per-tab counters.</footer>
    </main>
  );
}
