import { Group } from '@memoized-dom/data';
import { route } from '@memoized-dom/router';
import { getArticles, getProfile } from '#server-functions';
import { ArticlePreview, Avatar, FollowButton, Pager } from './components';
import { me } from './session';

export function Profile() {
  const profile = getProfile(route.params.username);
  let page = 1;
  const favorites = route.query.get('tab') === 'favorites';
  const articles = favorites
    ? getArticles(false, '', '', route.params.username, page)
    : getArticles(false, '', route.params.username, '', page);

  return (
    <Group pending={() => <p class="muted">Loading profile…</p>} error={({ error }) => <p class="error">{error.message}</p>}>
      <div class="profile-page">
        <section class="banner user">
          <Avatar profile={profile} size={100} />
          <h1>{profile.username}</h1>
          <p>{profile.bio}</p>
          {me !== null && me.username === profile.username
            ? <a class="button" route-to="/settings">Edit Profile Settings</a>
            : <FollowButton profile={profile} />}
        </section>
        <nav class="tabs">
          <a class={favorites ? '' : 'active'} route-to={{ path: '/profile/:username', params: { username: profile.username } }}>My Articles</a>
          <a class={favorites ? 'active' : ''} route-to={{ path: '/profile/:username', params: { username: profile.username }, query: { tab: 'favorites' } }}>Favorited Articles</a>
        </nav>
        {articles.articles.length === 0
          ? <p class="muted">No articles are here… yet.</p>
          : articles.articles.map(article => <ArticlePreview key={article.slug} article={article} />)}
        <Pager page={page} total={articles.articlesCount} size={3} onPage={next => page = next} />
      </div>
    </Group>
  );
}
