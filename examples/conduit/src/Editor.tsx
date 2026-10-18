import { $track } from '@memoized-dom/data';
import { navigate } from '@memoized-dom/router';
import { z } from 'zod';
import { getArticle, saveArticle } from '#server-functions';
import type { ArticleView } from '#server/store';
import { Markdown } from './components';

const articleSchema = z.object({
  title: z.string().trim().min(1, "Title can't be blank"),
  description: z.string().trim().min(1, "Description can't be blank"),
  body: z.string().trim().min(1, "Body can't be blank"),
});

function ArticleForm({ article }: { article: ArticleView | null }) {
  const tags = article === null ? [] : [...article.tagList];
  let draftTag = '';
  let body = article?.body ?? '';
  let preview = false;

  function addTag(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const name = draftTag.trim().toLowerCase();
    if (name !== '' && !tags.includes(name)) tags.push(name);
    draftTag = '';
  }

  const form = $forms({
    schema: articleSchema,
    action: fields => {
      const request = saveArticle(article?.slug ?? null, fields.title, fields.description, fields.body, tags);
      $track(request).onSuccess(saved => navigate('/article/:slug', { params: { slug: saved.slug } }));
      return request;
    },
  });

  return (
    <section class="editor">
      <ul class="error-messages">{form.errors.map(error => <li>{error.message}</li>)}</ul>
      <form onSubmit={form.submit}>
        <input name="title" placeholder="Article Title" value={article?.title ?? ''} />
        <input name="description" placeholder="What's this article about?" value={article?.description ?? ''} />
        <div class="body-tabs">
          <button type="button" class={preview ? '' : 'active'} onClick={() => preview = false}>Write</button>
          <button type="button" class={preview ? 'active' : ''} onClick={() => preview = true}>Preview</button>
        </div>
        <textarea name="body" rows={8} placeholder="Write your article (in markdown)" hidden={preview}
          value={body} onInput={event => body = event.currentTarget.value}></textarea>
        {preview ? <Markdown source={body} /> : null}
        <input placeholder="Enter tags" value={draftTag}
          onInput={event => draftTag = event.currentTarget.value} onKeyDown={addTag} />
        <ul class="tag-list editable">
          {tags.map(name => (
            <li key={name}>
              <button type="button" onClick={() => tags.splice(tags.indexOf(name), 1)}>×</button> {name}
            </li>
          ))}
        </ul>
        <button disabled={form.pending}>{form.pending ? 'Publishing…' : 'Publish Article'}</button>
      </form>
    </section>
  );
}

export function NewArticle() {
  return <ArticleForm article={null} />;
}

/** Editing waits for the article: the form must start from its saved text. */
export function EditArticle() {
  const article = $routed(({ params }) => getArticle(params.slug));
  return <ArticleForm article={article} />;
}
