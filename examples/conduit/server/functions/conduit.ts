import { deleteCookie, json, setCookie } from '@memoized-dom/server';
import { SESSION_COOKIE } from '../middleware';
import { define } from '../define';
import type { ArticleQuery } from '../store';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Expected failures (a wrong password, a taken username) are answers, not
 * crashes: return them as 4xx with a message the form can show. Anything
 * else still throws and stays a private 500.
 */
async function answer<T>(work: () => T | Promise<T>, status = 422) {
  try { return await work(); }
  catch (error) { return json({ message: (error as Error).message }, { status }); }
}

/** The session is the signed-in username in an HttpOnly cookie: a demo, not real auth. */
function withSession<T>(response: T & Response, username: string | null): T & Response {
  if (username === null) deleteCookie(response, SESSION_COOKIE, { sameSite: 'lax', httpOnly: true });
  else setCookie(response, SESSION_COOKIE, username, { maxAge: 60 * 60 * 24 * 30, sameSite: 'lax', httpOnly: true });
  return response;
}

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
    return answer(() => services.store.article(slug, state.user), 404);
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
    return answer(() => services.store.profile(username, state.user), 404);
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
    return answer(() => {
      const profile = services.store.login(email, password);
      return withSession(json(profile), profile.username);
    }, 401);
  },
});

export const register = define.function({
  async post({ services }, username: string, email: string, password: string) {
    await delay(300);
    return answer(() => {
      const profile = services.store.register(username, email, password);
      return withSession(json(profile, { status: 201 }), profile.username);
    });
  },
});

export const logout = define.function({
  async post() {
    return withSession(json({ ok: true }), null);
  },
});

export const saveSettings = define.function({
  async post({ services, state }, bio: string, image: string) {
    await delay(300);
    return answer(() => {
      if (state.user === null) throw new Error('Sign in first');
      return services.store.settings(state.user, { bio, image });
    });
  },
  updates: ({ state }) => ['conduit', 'profiles', state.user ?? ''],
});

export const saveArticle = define.function({
  async post({ services, state }, slug: string | null, title: string, description: string, body: string, tagList: string[]) {
    await delay(400);
    return answer(() => services.store.save(state.user, slug, { title, description, body, tagList }));
  },
  updates: () => ['conduit', 'articles'],
});

export const deleteArticle = define.function({
  async delete({ services, state }, slug: string) {
    await delay(300);
    return answer(() => services.store.remove(state.user, slug), 403);
  },
  updates: () => ['conduit', 'articles'],
});

export const favorite = define.function({
  async post({ services, state }, slug: string, on: boolean) {
    await delay(500);
    return answer(() => services.store.favorite(state.user, slug, on), 401);
  },
  updates: (_context, slug) => ['conduit', 'articles', slug],
});

export const follow = define.function({
  async post({ services, state }, username: string, on: boolean) {
    await delay(400);
    return answer(() => services.store.follow(state.user, username, on), 401);
  },
  // Following changes both the profile card and the personal feed.
  updates: () => ['conduit'],
});

export const addComment = define.function({
  async post({ services, state }, slug: string, body: string) {
    await delay(300);
    return answer(() => {
      if (body.trim() === '') throw new Error('Write something first');
      return services.store.comment(state.user, slug, body);
    });
  },
  updates: (_context, slug) => ['conduit', 'articles', slug, 'comments'],
});

export const deleteComment = define.function({
  async delete({ services, state }, slug: string, id: string) {
    await delay(200);
    return answer(() => { services.store.uncomment(state.user, id); return { id, slug }; }, 403);
  },
  updates: (_context, slug) => ['conduit', 'articles', slug, 'comments'],
});
