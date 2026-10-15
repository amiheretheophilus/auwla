export function Receipt({ title, saved }: { title: string; saved: boolean }) {
  return (
    <aside class="receipt" data-receipt>
      <span class="eyebrow">Finite server-rendered result</span>
      <h3>{title}</h3>
      <p if={saved}>The POST returned this UI directly. No receipt refetch or live connection.</p>
      <p if={!saved}>Submit the form to replace just this result.</p>
    </aside>
  );
}
