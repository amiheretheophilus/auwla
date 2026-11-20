/**
 * The navigation benchmark's app: ten component routes, a route with a parameter, and state the
 * app passes to every page, so a prop change reaches the page on screen.
 */
import { route } from '@memoized-dom/router';

function Page({ name, count }: { name: string; count: number }) {
  return (
    <section data-page={name}>
      <h1>{name}</h1>
      <p class="count">{count}</p>
    </section>
  );
}

function Post({ count }: { count: number }) {
  return (
    <article data-page="post">
      <h1>{'post ' + route.params.id}</h1>
      <p class="count">{count}</p>
    </article>
  );
}

export function App() {
  let count = 0;

  return (
    <main>
      <button id="bump" onClick={() => count++}>bump</button>
      <Page route="/p0" name="p0" count={count} />
      <Page route="/p1" name="p1" count={count} />
      <Page route="/p2" name="p2" count={count} />
      <Page route="/p3" name="p3" count={count} />
      <Page route="/p4" name="p4" count={count} />
      <Page route="/p5" name="p5" count={count} />
      <Page route="/p6" name="p6" count={count} />
      <Page route="/p7" name="p7" count={count} />
      <Page route="/p8" name="p8" count={count} />
      <Page route="/p9" name="p9" count={count} />
      <Post route="/posts/:id" count={count} />
    </main>
  );
}
