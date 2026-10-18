import { $track, Group } from '@memoized-dom/data';
import { navigate, route } from '@memoized-dom/router';
import { z } from 'zod';
import { addComment, deleteArticle, deleteComment, getArticle, getComments } from '#server-functions';
import { AuthorLine, Avatar, FavoriteButton, FollowButton, Markdown, TagList } from './components';
import { ago } from './format';
import { me } from './session';

const commentSchema = z.object({ body: z.string().trim().min(1, 'Write something first') });

function Loading() { return <p class="muted">Loading article…</p>; }
function Missing({ error }: { error: Error }) {
  return <section class="missing"><h1>{error.message}</h1><a route-to="/">Back home</a></section>;
}

function ArticleActions({ article }: { article: Parameters<typeof AuthorLine>[0]['article'] }) {
  let deleting = false;
  function remove() {
    deleting = true;
    const request = $track(deleteArticle(article.slug));
    request.onSuccess(() => navigate('/'));
    request.onError(() => { deleting = false; });
  }
  return me !== null && me.username === article.author.username ? (
    <div class="actions">
      <a class="button" route-to={{ path: '/editor/:slug', params: { slug: article.slug } }}>Edit Article</a>
      <button class="danger" disabled={deleting} onClick={remove}>{deleting ? 'Deleting…' : 'Delete Article'}</button>
    </div>
  ) : (
    <div class="actions">
      <FollowButton profile={article.author} />
      <FavoriteButton article={article} compact={false} />
    </div>
  );
}

function Comments({ slug }: { slug: string }) {
  const comments = getComments(slug);
  const removing = new Set<string>();
  const form = $forms({
    schema: commentSchema,
    action: fields => {
      const request = addComment(slug, fields.body);
      $track(request).onSuccess(() => { if (nodes.body) nodes.body.value = ''; });
      return request;
    },
  });
  const nodes: { body?: HTMLTextAreaElement } = {};
  function remove(id: string) {
    removing.add(id);
    $track(deleteComment(slug, id)).onError(() => { removing.delete(id); });
  }
  return (
    <section class="comments">
      {me !== null ? (
        <form class="comment-form" onSubmit={form.submit}>
          <textarea name="body" ref={nodes.body} placeholder="Write a comment…" rows={3}></textarea>
          {form.errors.map(error => <p class="error">{error.message}</p>)}
          <button disabled={form.pending}>{form.pending ? 'Posting…' : 'Post Comment'}</button>
        </form>
      ) : (
        <p><a route-to="/login">Sign in</a> to add comments on this article.</p>
      )}
      <Group pending={() => <p class="muted">Loading comments…</p>}>
        {comments.map(comment => (
          <div key={comment.id} class={removing.has(comment.id) ? 'comment removing' : 'comment'}>
            <p>{comment.body}</p>
            <footer>
              <Avatar profile={comment.author} size={20} />
              <span>{comment.author.username}</span>
              <span class="date">{ago(comment.createdAt)}</span>
              {me !== null && me.username === comment.author.username
                ? <button class="link" onClick={() => remove(comment.id)}>delete</button>
                : null}
            </footer>
          </div>
        ))}
      </Group>
    </section>
  );
}


export function Article() {
  const article = getArticle(route.params.slug);
  return (
    <Group pending={Loading} error={Missing}>
      <div class="article-page" suspend>
        <section class="banner dark">
          <h1>{article.title}</h1>
          <AuthorLine article={article} />
          <ArticleActions article={article} />
        </section>
        <section class="article-body">
          <Markdown source={article.body} />
          <TagList tags={article.tagList} />
        </section>
        <Comments slug={article.slug} />
      </div>
    </Group>
  );
}
