import { define } from '../define';
import { loginMember, registerMember } from '../auth/routes';

// Signing up and in work signed out, so this file has no guard. Calls that need a member are
// in `payments.ts`.

export const signUp = define.function({
  async post({ request }, name: string, email: string, password: string) {
    return registerMember(request, name, email, password);
  },
});

export const memberLogin = define.function({
  async post({ request }, email: string, password: string) {
    return loginMember(request, email, password);
  },
});
