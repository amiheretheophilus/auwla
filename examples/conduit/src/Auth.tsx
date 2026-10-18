import { $track } from '@memoized-dom/data';
import { navigate } from '@memoized-dom/router';
import { z } from 'zod';
import { login, register } from '#server-functions';
import { signedIn } from './session';

const credentials = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Passwords have at least 8 characters'),
});
const signup = credentials.extend({
  username: z.string().min(2, 'Usernames have at least 2 characters').regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits and _'),
});

function Errors({ errors }: { errors: readonly { message: string; path?: readonly PropertyKey[] }[] }) {
  return errors.length === 0 ? null : (
    <ul class="error-messages">
      {errors.map(error => <li>{error.path?.length ? `${String(error.path[0])}: ` : ''}{error.message}</li>)}
    </ul>
  );
}

export function Login() {
  const form = $forms({
    schema: credentials,
    action: fields => {
      const request = login(fields.email, fields.password);
      $track(request).onSuccess(() => { signedIn(); navigate('/'); });
      return request;
    },
  });
  return (
    <section class="auth">
      <h1>Sign in</h1>
      <a route-to="/register">Need an account?</a>
      <Errors errors={form.errors} />
      <form onSubmit={form.submit}>
        <input name="email" type="email" placeholder="Email" />
        <input name="password" type="password" placeholder="Password" />
        <button disabled={form.pending}>{form.pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p class="muted">Try ada@conduit.dev / password</p>
    </section>
  );
}

export function Register() {
  const form = $forms({
    schema: signup,
    action: fields => {
      const request = register(fields.username, fields.email, fields.password);
      $track(request).onSuccess(() => { signedIn(); navigate('/'); });
      return request;
    },
  });
  return (
    <section class="auth">
      <h1>Sign up</h1>
      <a route-to="/login">Have an account?</a>
      <Errors errors={form.errors} />
      <form onSubmit={form.submit}>
        <input name="username" placeholder="Username" />
        <input name="email" type="email" placeholder="Email" />
        <input name="password" type="password" placeholder="Password" />
        <button disabled={form.pending}>Sign up</button>
      </form>
    </section>
  );
}
