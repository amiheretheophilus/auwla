import { define } from '../define';
import { memberOf, requireMember, sameSite } from '../auth/guards';
import { submitPayment } from '../members/payments';

export const middleware = [sameSite, requireMember];

export const claimPayment = define.function({
  async post({ state }, planId: string, axis: string, method: string, reference: string) {
    return submitPayment(memberOf(state).id, planId, axis, method, reference);
  },
});
