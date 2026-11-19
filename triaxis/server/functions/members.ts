import { define } from '../define';
import { loginMember, registerMember, isSameOrigin } from '../auth/routes';
import { getMember } from '../members/access';
import { submitPayment } from '../members/payments';

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

export const claimPayment = define.function({
  async post({ request }, planId: string, axis: string, method: string, reference: string) {
    if (!isSameOrigin(request)) {
      return { ok: false, message: 'Subscribe from the Triaxis site.' } as const;
    }
    const signedIn = await getMember(request);
    if (!signedIn) {
      return { ok: false, message: 'Your session has ended. Sign in again.' } as const;
    }
    return submitPayment(signedIn.member.id, planId, axis, method, reference);
  },
});
