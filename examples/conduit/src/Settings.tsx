import { $track } from '@memoized-dom/data';
import { navigate } from '@memoized-dom/router';
import { getMe, saveSettings } from '#server-functions';
import { signOut } from './session';

export function Settings() {
  // The page waits for the saved profile, then edits a copy of it.
  const me = $routed(() => getMe());
  let bio = me?.bio ?? '';
  let image = me?.image ?? '';
  let saved = false;

  const form = $forms((_fields: FormData) => {
    saved = false;
    const request = saveSettings(bio, image);
    $track(request).onSuccess(() => { saved = true; });
    return request;
  });

  function leave() { signOut(); navigate('/'); }

  return me === null ? (
    <section class="auth"><p>You are signed out. <a route-to="/login">Sign in</a></p></section>
  ) : (
    <section class="settings">
      <h1>Your Settings</h1>
      <form onSubmit={form.submit}>
        <input placeholder="URL of profile picture" value={image} onInput={event => image = event.currentTarget.value} />
        <textarea rows={6} placeholder="Short bio about you" value={bio} onInput={event => bio = event.currentTarget.value}></textarea>
        <button disabled={form.pending}>{form.pending ? 'Saving…' : 'Update Settings'}</button>
        {saved ? <span class="saved">Saved.</span> : null}
        {form.errors.map(error => <p class="error">{error.message}</p>)}
      </form>
      <hr />
      <button class="danger" onClick={leave}>Or click here to logout.</button>
    </section>
  );
}
