import { error } from '@memoized-dom/server';
import { define } from '../define';
import { requireStaff, sameSite, staffOf } from '../auth/guards';
import { createAnalysis, publishAnalysis, saveAnalysis } from '../desk/analyses';
import { decidePayment } from '../members/payments';

export const middleware = [sameSite, requireStaff];

export const startAnalysis = define.function({
  async post({ state }) {
    return createAnalysis(staffOf(state));
  },
});

export const saveAnalysisDraft = define.function({
  async post({ state }, id: number, revision: number, fields: Record<string, unknown>) {
    return saveAnalysis(id, revision, fields, staffOf(state));
  },
});

export const postAnalysis = define.function({
  async post({ state }, id: number, revision: number) {
    return publishAnalysis(id, revision, staffOf(state));
  },
});

export const decideMemberPayment = define.function({
  async post({ state }, id: number, decision: 'approved' | 'rejected') {
    if (decision !== 'approved' && decision !== 'rejected') {
      return error({ message: 'Approve or reject the payment.' }, { status: 400 });
    }

    return decidePayment(id, decision, staffOf(state));
  },
});
