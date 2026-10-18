import { define } from '../define';
import type { ArticleQuery } from '../store';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Live keys form one tree, so prefix invalidation reaches the right readers:
//   ['conduit', 'articles']                    every feed and the tag cloud
//   ['conduit', 'articles', slug]              one article (and its feeds above)
//   ['conduit', 'articles', slug, 'comments']  its comments
//   ['conduit', 'profiles', username]          a profile card

export const getArticles = define.function({
  // GET parameters travel in the URL query, so each one is a scalar.
  async get({ services, state }, feed: boolean, tag: string, author: string, favorited: string, page: number) {
    await delay(250);
    const query: ArticleQuery = { feed, tag: tag || undefined, author: author || undefined, favorited: favorited || undefined, page };
    return services.store.articles(query, state.user);
  },
  live: () => ['conduit', 'articles'],
});

export const getTags = define.function({
  async get({ services }) {
    await delay(150);
    return services.store.tags();
  },
  live: () => ['conduit', 'articles'],
});

export const getArticle = define.function({
  async get({ services, state }, slug: string) {
    await delay(200);
    return services.store.article(slug, state.user);
  },
  live: (_context, slug) => ['conduit', 'articles', slug],
});

export const getComments = define.function({
  async get({ services, state }, slug: string) {
    return services.store.comments(slug, state.user);
  },
  live: (_context, slug) => ['conduit', 'articles', slug, 'comments'],
});

export const getProfile = define.function({
  async get({ services, state }, username: string) {
    await delay(150);
    return services.store.profile(username, state.user);
  },
  live: (_context, username) => ['conduit', 'profiles', username],
});

/** The signed-in reader, or null. Re-read after the session cookie changes. */
export const getMe = define.function({
  async get({ services, state }) {
    return state.user === null ? null : services.store.profile(state.user, state.user);
  },
  live: ({ state }) => ['conduit', 'profiles', state.user ?? ''],
});

export const login = define.function({
  async post({ services }, email: string, password: string) {
    await delay(300);
    return services.store.login(email, password);
  },
});

export const register = define.function({
  async post({ services }, username: string, email: string, password: string) {
    await delay(300);
    return services.store.register(username, email, password);
  },
});

export const saveSettings = define.function({
  async post({ services, state }, bio: string, image: string) {
    if (state.user === null) throw new Error('Sign in first');
    await delay(300);
    return services.store.settings(state.user, { bio, image });
  },
  updates: ({ state }) => ['conduit', 'profiles', state.user ?? ''],
});

export const saveArticle = define.function({
  async post({ services, state }, slug: string | null, title: string, description: string, body: string, tagList: string[]) {
    await delay(400);
    return services.store.save(state.user, slug, { title, description, body, tagList });
  },
  updates: () => ['conduit', 'articles'],
});

export const deleteArticle = define.function({
  async delete({ services, state }, slug: string) {
    await delay(300);
    return services.store.remove(state.user, slug);
  },
  updates: () => ['conduit', 'articles'],
});

export const favorite = define.function({
  async post({ services, state }, slug: string, on: boolean) {
    await delay(500);
    return services.store.favorite(state.user, slug, on);
  },
  updates: (_context, slug) => ['conduit', 'articles', slug],
});

export const follow = define.function({
  async post({ services, state }, username: string, on: boolean) {
    await delay(400);
    return services.store.follow(state.user, username, on);
  },
  // Following changes both the profile card and the personal feed.
  updates: () => ['conduit'],
});

export const addComment = define.function({
  async post({ services, state }, slug: string, body: string) {
    if (body.trim() === '') throw new Error('Write something first');
    await delay(300);
    return services.store.comment(state.user, slug, body);
  },
  updates: (_context, slug) => ['conduit', 'articles', slug, 'comments'],
});

export const deleteComment = define.function({
  async delete({ services, state }, slug: string, id: string) {
    await delay(200);
    services.store.uncomment(state.user, id);
    return { id, slug };
  },
  updates: (_context, slug) => ['conduit', 'articles', slug, 'comments'],
});
