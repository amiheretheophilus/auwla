import { route } from '@memoized-dom/router';
import { commentText, createHackerNewsData, loadStory, storyDomain, timeAgo } from './api';
import type { HackerNewsComment } from './types';

function Comment({ comment }: { comment: HackerNewsComment }) {
  return (
    <article class="comment">
      <div class="comment-meta">
        <span class="vote-triangle" /> {comment.author ?? '[deleted]'} {timeAgo(comment.created_at_i)}
      </div>
      <p>{commentText(comment.text)}</p>
      {comment.children.length > 0 && (
        <span class="comment-replies">
          {comment.children.length} nested replies
        </span>
      )}
    </article>
  );
}

export function StoryPage() {
  const storyId = route.params['storyId'] ?? '';
  const data = createHackerNewsData();
  const story = loadStory(data, storyId);
  $cleanup(data.clear);

  return (
    <main class="story-page">
      <a class="back-link" route-to="/">← back to stories</a>
      {story.pending && !story.data ? (
        <div class="story-page-loading">
          Loading discussion…
        </div>
      ) : story.error && !story.data ? (
        <div class="feed-message feed-error">
          <strong>Discussion unavailable.</strong>
          <span>{story.error?.message}</span>
          <button onClick={() => story.refresh()}>try again</button>
        </div>
      ) : story.data ? (
        <div class="discussion-content">
          <header class="discussion-header">
            <h1>{story.data?.title}</h1>
            <div class="discussion-meta">
              {story.data?.points} points by {story.data?.author} {timeAgo(story.data?.created_at_i ?? 0)}
              {storyDomain(story.data?.url) && <span> · {storyDomain(story.data?.url)}</span>}
            </div>
            {story.data?.url && (
              <a class="source-link" href={story.data?.url} target="_blank" rel="noreferrer">
                visit original story ↗
              </a>
            )}
          </header>
          <section class="comments" aria-label="Comments">
            <h2>{story.data?.children.length ?? 0} top-level comments</h2>
            {story.data?.children.map(comment => <Comment key={comment.id} comment={comment} />)}
          </section>
        </div>
      ) : null}
    </main>
  );
}
