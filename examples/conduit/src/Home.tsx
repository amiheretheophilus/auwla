import { $track, Group } from '@memoized-dom/data';
import { getArticles, getTags } from '#server-functions';
import { ArticlePreview, Pager } from './components';
import { me } from './session';

function Loading() { return <p class="muted">Loading articles…</p>; }
function Failed({ error, retry }: { error: Error; retry: () => void }) {
  return <p class="error">{error.message} <button onClick={retry}>Retry</button></p>;
}

export function Home() {
  let tab: 'feed' | 'global' | 'tag' = 'global';
  let tag = '';
  let page = 1;
  const feed = getArticles(tab === 'feed', tab === 'tag' ? tag : '', '', '', page);
  const tags = getTags();

  function show(next: 'feed' | 'global') { tab = next; tag = ''; page = 1; }
  function pickTag(name: string) { tab = 'tag'; tag = name; page = 1; }

  return (
    <div class="home">
      <section class="banner">
        <h1>conduit</h1>
        <p>A place to share your knowledge.</p>
      </section>
      <div class="columns">
        <main>
          <nav class="tabs">
            {me !== null ? <button class={tab === 'feed' ? 'active' : ''} onClick={() => show('feed')}>Your Feed</button> : null}
            <button class={tab === 'global' ? 'active' : ''} onClick={() => show('global')}>Global Feed</button>
            {tab === 'tag' ? <button class="active"># {tag}</button> : null}
            {$track(feed).refreshing ? <span class="updating">updating…</span> : null}
          </nav>
          <Group pending={Loading} error={Failed}>
            {feed.articles.length === 0
              ? <p class="muted">No articles are here… yet.</p>
              : feed.articles.map(article => <ArticlePreview key={article.slug} article={article} />)}
            <Pager page={page} total={feed.articlesCount} size={3} onPage={next => page = next} />
          </Group>
        </main>
        <aside class="sidebar">
          <p>Popular Tags</p>
          <Group pending={() => <p class="muted">Loading tags…</p>}>
            <div class="tag-cloud">
              {tags.map(name => <button key={name} class="tag" onClick={() => pickTag(name)}>{name}</button>)}
            </div>
          </Group>
        </aside>
      </div>
    </div>
  );
}
