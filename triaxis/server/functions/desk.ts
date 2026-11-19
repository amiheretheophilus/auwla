import { define } from '../define';
import { createAnalysis, publishAnalysis, saveAnalysis } from '../desk/analyses';
import { getAnalyst } from '../auth/auth';
import { decidePayment } from '../members/payments';
import { isSameOrigin } from '../auth/routes';
import type { StaffMember } from '../../src/desk/analysis';

type DeskFailure = { readonly ok: false; readonly message: string };

/** Runs `action` for the signed-in member of staff, from the desk's own origin only. */
async function asStaff<T>(request: Request, action: (staff: StaffMember) => T): Promise<T | DeskFailure> {
  if (!isSameOrigin(request)) return { ok: false, message: 'Use the Triaxis desk for this.' };
  const staff = await getAnalyst(request);
  if (!staff) return { ok: false, message: 'Your desk session has ended. Sign in again.' };
  return action(staff);
}

export const startAnalysis = define.function({
  async post({ request }) {
    return asStaff(request, staff => createAnalysis(staff));
  },
});

export const saveAnalysisDraft = define.function({
  async post({ request }, id: number, revision: number, fields: Record<string, unknown>) {
    return asStaff(request, staff => saveAnalysis(id, revision, fields, staff));
  },
});

export const decideMemberPayment = define.function({
  async post({ request }, id: number, decision: 'approved' | 'rejected') {
    if (decision !== 'approved' && decision !== 'rejected') {
      return { ok: false, message: 'Approve or reject the payment.' } as const;
    }
    return asStaff(request, staff => decidePayment(id, decision, staff));
  },
});

export const postAnalysis = define.function({
  async post({ request }, id: number, revision: number) {
    return asStaff(request, staff => publishAnalysis(id, revision, staff));
  },
});
