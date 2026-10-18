import { $track } from '@memoized-dom/data';
import { navigate } from '@memoized-dom/router';
import { favorite, follow } from '#server-functions';
import type { ArticleView, Profile } from '#server/store';
import { me } from './session';
import { longDate, renderMarkdown } from './format';

export function Avatar({ profile, size }: { profile: Profile; size: number }) {
  return <img class="avatar" src={profile.image} alt="" width={size} height={size} />;
}

export function AuthorLine({ article }: { article: ArticleView }) {
  return (
    <div class="author-line">
      <Avatar profile={article.author} size={32} />
      <div>
        <a class="author" route-to={{ path: '/profile/:username', params: { username: article.author.username } }}>
          {article.author.username}
        </a>
        <span class="date">{longDate(article.createdAt)}</span>
      </div>
    </div>
  );
}

/** Optimistic: the heart flips at once and rolls back if the server refuses. */
export function FavoriteButton({ article, compact }: { article: ArticleView; compact: boolean }) {
  function toggle() {
    if (me === null) { navigate('/login'); return; }
    const on = !article.favorited;
    article.favorited = on;
    article.favoritesCount += on ? 1 : -1;
    $track(favorite(article.slug, on)).onError(() => {
      article.favorited = !on;
      article.favoritesCount += on ? -1 : 1;
    });
  }
  return (
    <button class={article.favorited ? 'favorite on' : 'favorite'} onClick={toggle}>
      ♥ {compact ? '' : article.favorited ? 'Unfavorite ' : 'Favorite '}{article.favoritesCount}
    </button>
  );
}

export function FollowButton({ profile }: { profile: Profile }) {
  let saving = false;
  function toggle() {
    if (me === null) { navigate('/login'); return; }
    saving = true;
    const request = $track(follow(profile.username, !profile.following));
    request.onSuccess(updated => { profile.following = updated.following; saving = false; });
    request.onError(() => { saving = false; });
  }
  return (
    <button class="follow" disabled={saving} onClick={toggle}>
      {profile.following ? '− Unfollow ' : '+ Follow '}{profile.username}
    </button>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  return <ul class="tag-list">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>;
}

export function ArticlePreview({ article }: { article: ArticleView }) {
  return (
    <article class="preview">
      <header>
        <AuthorLine article={article} />
        <FavoriteButton article={article} compact={true} />
      </header>
      <a class="preview-link" route-to={{ path: '/article/:slug', params: { slug: article.slug } }}>
        <h2>{article.title}</h2>
        <p>{article.description}</p>
        <span>Read more…</span>
      </a>
      <TagList tags={article.tagList} />
    </article>
  );
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (page: number) => void }) {
  const pages = Array.from({ length: Math.ceil(total / size) }, (_, index) => index + 1);
  return pages.length < 2 ? null : (
    <nav class="pager">
      {pages.map(number => (
        <button key={number} class={number === page ? 'current' : ''} onClick={() => onPage(number)}>{number}</button>
      ))}
    </nav>
  );
}

/** Rendered markdown; written through a ref because it is HTML, not text. */
export function Markdown({ source }: { source: string }) {
  let host: HTMLDivElement | undefined;
  $effect(() => {
    if (host !== undefined) host.innerHTML = renderMarkdown(source);
  });
  return <div class="markdown" ref={host}></div>;
}
