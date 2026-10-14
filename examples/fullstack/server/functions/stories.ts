/**
 * Server functions — named HTTP endpoints generated from this module.
 *
 * Every verb-prefixed async export becomes a real HTTP route mounted at
 * `/_fn/stories/<name>` by `serve()`, and a typed `$fetch` facade that
 * client code imports from `#server-functions`. This module's `middleware`
 * export composes in front of every endpoint it registers (RFC §11):
 * here it logs each server-function invocation.
 *
 * The injected first argument carries the same request state the session
 * middleware in server.ts populated for this dispatch.
 */
import { define } from '../define';


function logServerFunction() {
  return define.middleware((context, next) => {
    console.log(`[fn] ${context.request.method} ${context.url.pathname}`);
    return next();
  });
}

export const middleware = [
  logServerFunction(),
];

interface Story {
  id: number;
  title: string;
  summary: string;
  votes: number;
}

const stories: Story[] = [
  {
    id: 1,
    title: 'Middleware composes like any HTTP endpoint',
    summary: 'Module and directory middleware run in front of every generated server function.',
    votes: 3,
  },
  {
    id: 2,
    title: 'One data source for SSR and the browser',
    summary: 'The same route serves in-memory dispatch during SSR and real HTTP afterwards.',
    votes: 5,
  },
  {
    id: 3,
    title: 'Mutations are compiler-gated',
    summary: 'post* functions cannot run during render — only from event handlers.',
    votes: 2,
  },
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const getStories = define.function({
  async get() {
    await delay(3000);
    return stories;
  },
});

export const getStory = define.function({
  async get(_context, id: number) {
    await delay(3000);
    return stories.find((story) => story.id === id) ?? null;
  },
});

export const vote = define.function({
  async post({ state }, id: number) {
    const story = stories.find((candidate) => candidate.id === id)!;

    story.votes += 1;
    await delay(3000);
    if(story.votes === 10 || story.votes === 15 || story.votes === 16 || story.votes === 18) {
      throw new Error('Story has reached the vote limit');
    }
    return { id: story.id, votes: story.votes, by: state.user ?? 'anonymous' };
  },
});

export const removeStory = define.function({
  async delete({ request }, id: number) {
    if (request.headers.get('x-admin') !== 'yes') {
      throw new Error('removeStory requires the x-admin: yes header');
    }
    const index = stories.findIndex((story) => story.id === id);
    if (index === -1) {
      throw new Error(`Unknown story ${String(id)}`);
    }

    await delay(3000);
    return stories.splice(index, 1)[0]!;
  },
});
