import { nanoid } from 'nanoid';

export interface User { username: string; email: string; password: string; bio: string; image: string }
export interface Article {
  slug: string; title: string; description: string; body: string; tagList: string[];
  createdAt: string; updatedAt: string; author: string; favoritedBy: Set<string>;
}
export interface Comment { id: string; slug: string; body: string; author: string; createdAt: string }

/** Public shapes: what crosses the wire. */
export interface Profile { username: string; bio: string; image: string; following: boolean }
export interface ArticleView {
  slug: string; title: string; description: string; body: string; tagList: string[];
  createdAt: string; updatedAt: string; favorited: boolean; favoritesCount: number; author: Profile;
}
export interface CommentView { id: string; body: string; createdAt: string; author: Profile }
export interface ArticleQuery { tag?: string; author?: string; favorited?: string; feed?: boolean; page?: number }

const avatar = (seed: string) => `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(seed)}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + nanoid(6);
}

export function createStore() {
  const users = new Map<string, User>();
  const articles = new Map<string, Article>();
  const comments: Comment[] = [];
  const follows = new Set<string>(); // `${follower}->${followed}`

  for (const [username, bio] of [
    ['ada', 'Analytical engines and poetry.'],
    ['grace', 'It is easier to ask forgiveness than it is to get permission.'],
    ['linus', 'Talk is cheap. Show me the code.'],
  ] as const) {
    users.set(username, { username, email: `${username}@conduit.dev`, password: 'password', bio, image: avatar(username) });
  }
  const seed = (author: string, title: string, description: string, body: string, tagList: string[], age: number, fans: string[]) => {
    // Seed slugs stay stable across server reloads, so links keep working.
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    articles.set(slug, { slug, title, description, body, tagList, author, createdAt: daysAgo(age), updatedAt: daysAgo(age), favoritedBy: new Set(fans) });
    return slug;
  };
  const first = seed('ada', 'Notes on the Analytical Engine', 'What a machine can and cannot originate.',
    '## The engine weaves\n\nThe Analytical Engine weaves **algebraic patterns** just as the Jacquard loom weaves flowers and leaves.\n\n- It has no pretensions to *originate* anything\n- It can do whatever we know how to order it to perform', ['history', 'computing'], 9, ['grace']);
  seed('grace', 'Debugging, literally', 'The moth in relay #70.',
    'We found a **moth** trapped in a relay. First actual case of bug being found.\n\n```\nRelay #70 Panel F\n```', ['history', 'debugging'], 4, ['ada', 'linus']);
  seed('linus', 'Small patches win', 'Why reviewers love tiny diffs.',
    'Send *small* patches.\n\n1. Easier to review\n2. Easier to revert\n3. Easier to bisect', ['git', 'review'], 2, []);
  seed('grace', 'COBOL is not dead', 'It runs your bank.', 'Business logic outlives fashion.', ['computing'], 1, ['ada']);
  comments.push({ id: nanoid(), slug: first, body: 'Still the best description of computation.', author: 'grace', createdAt: daysAgo(3) });
  follows.add('ada->grace');

  const profile = (username: string, viewer: string | null): Profile => {
    const user = users.get(username);
    if (!user) throw new Error(`No such user: ${username}`);
    return { username, bio: user.bio, image: user.image, following: viewer !== null && follows.has(`${viewer}->${username}`) };
  };
  const view = (article: Article, viewer: string | null): ArticleView => ({
    slug: article.slug, title: article.title, description: article.description, body: article.body,
    tagList: [...article.tagList], createdAt: article.createdAt, updatedAt: article.updatedAt,
    favorited: viewer !== null && article.favoritedBy.has(viewer),
    favoritesCount: article.favoritedBy.size,
    author: profile(article.author, viewer),
  });
  const find = (slug: string) => {
    const article = articles.get(slug);
    if (!article) throw new Error('Article not found');
    return article;
  };
  const own = (slug: string, viewer: string | null) => {
    const article = find(slug);
    if (article.author !== viewer) throw new Error('Only the author can change this article');
    return article;
  };

  return {
    pageSize: 3,
    login(email: string, password: string) {
      const user = [...users.values()].find(entry => entry.email === email && entry.password === password);
      if (!user) throw new Error('Email or password is invalid');
      return profile(user.username, user.username);
    },
    register(username: string, email: string, password: string) {
      if (users.has(username)) throw new Error('That username is taken');
      if ([...users.values()].some(entry => entry.email === email)) throw new Error('That email is registered');
      users.set(username, { username, email, password, bio: '', image: avatar(username) });
      return profile(username, username);
    },
    settings(viewer: string, changes: { bio: string; image: string }) {
      const user = users.get(viewer);
      if (!user) throw new Error('Sign in first');
      user.bio = changes.bio;
      user.image = changes.image || avatar(viewer);
      return profile(viewer, viewer);
    },
    profile,
    articles(query: ArticleQuery, viewer: string | null) {
      let list = [...articles.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (query.feed) list = list.filter(article => viewer !== null && follows.has(`${viewer}->${article.author}`));
      if (query.tag) list = list.filter(article => article.tagList.includes(query.tag!));
      if (query.author) list = list.filter(article => article.author === query.author);
      if (query.favorited) list = list.filter(article => article.favoritedBy.has(query.favorited!));
      const page = query.page ?? 1;
      return {
        articles: list.slice((page - 1) * this.pageSize, page * this.pageSize).map(article => view(article, viewer)),
        articlesCount: list.length,
      };
    },
    article: (slug: string, viewer: string | null) => view(find(slug), viewer),
    tags: () => [...new Set([...articles.values()].flatMap(article => article.tagList))].sort(),
    save(viewer: string | null, slug: string | null, input: { title: string; description: string; body: string; tagList: string[] }) {
      if (viewer === null) throw new Error('Sign in to publish');
      const now = new Date().toISOString();
      if (slug === null) {
        const created = slugify(input.title);
        articles.set(created, { ...input, slug: created, author: viewer, createdAt: now, updatedAt: now, favoritedBy: new Set() });
        return view(articles.get(created)!, viewer);
      }
      const article = own(slug, viewer);
      Object.assign(article, input, { updatedAt: now });
      return view(article, viewer);
    },
    remove(viewer: string | null, slug: string) {
      own(slug, viewer);
      articles.delete(slug);
      for (let index = comments.length - 1; index >= 0; index--) if (comments[index]!.slug === slug) comments.splice(index, 1);
      return { slug };
    },
    favorite(viewer: string | null, slug: string, on: boolean) {
      if (viewer === null) throw new Error('Sign in to favorite');
      const article = find(slug);
      if (on) article.favoritedBy.add(viewer); else article.favoritedBy.delete(viewer);
      return view(article, viewer);
    },
    follow(viewer: string | null, username: string, on: boolean) {
      if (viewer === null) throw new Error('Sign in to follow');
      if (viewer === username) throw new Error('You cannot follow yourself');
      if (on) follows.add(`${viewer}->${username}`); else follows.delete(`${viewer}->${username}`);
      return profile(username, viewer);
    },
    comments: (slug: string, viewer: string | null): CommentView[] => comments
      .filter(comment => comment.slug === slug)
      .map(comment => ({ id: comment.id, body: comment.body, createdAt: comment.createdAt, author: profile(comment.author, viewer) })),
    comment(viewer: string | null, slug: string, body: string): CommentView {
      if (viewer === null) throw new Error('Sign in to comment');
      find(slug);
      const comment = { id: nanoid(), slug, body, author: viewer, createdAt: new Date().toISOString() };
      comments.push(comment);
      return { id: comment.id, body, createdAt: comment.createdAt, author: profile(viewer, viewer) };
    },
    uncomment(viewer: string | null, id: string) {
      const index = comments.findIndex(comment => comment.id === id);
      if (index === -1) throw new Error('Comment not found');
      if (comments[index]!.author !== viewer) throw new Error('Only the author can delete this comment');
      return comments.splice(index, 1)[0]!.slug;
    },
  };
}

export type Store = ReturnType<typeof createStore>;
