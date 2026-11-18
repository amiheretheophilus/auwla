import { define } from '../define';
import { writeDraft } from '../desk/draft';
import { isAnalyst } from '../auth/auth';
import { isSameOrigin } from '../auth/routes';

const requireAnalyst = define.middleware(async (context, next) => {
  if (!await isAnalyst(context.request)) return new Response('Analyst sign-in required', { status: 401 });
  return next();
});

export const saveSignalDraft = define.function({
  middleware: [requireAnalyst],
  async post({ request }, revision: number, fields: Record<string, unknown>) {
    if (!isSameOrigin(request)) {
      return { ok: false, message: 'Save the draft from the Triaxis desk.' } as const;
    }
    return writeDraft(fields, revision);
  },
});
