import { json } from '@memoized-dom/server';
import { getAnalyst } from '../auth/auth';
import { isSameOrigin } from '../auth/routes';
import { publishSavedDraft } from '../desk/publications';
import { define } from '../define';

export const publishSignal = define.function({
  async post({ request }, revision: number) {
    if (!isSameOrigin(request)) return json({ message: 'Publish from the Triaxis desk.' }, { status: 403 });

    const analyst = await getAnalyst(request);
    if (!analyst) return json({ message: 'Analyst sign-in required.' }, { status: 401 });

    return publishSavedDraft(revision, analyst.id);
  },
});
