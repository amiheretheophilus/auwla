import { signalCardFromDraft, type PublishedSignal, type SignalCardData } from '../../src/signals/signal-card';
import type { SignalReview } from '../../src/desk/draft/model/signal-review';
import { draftWorkspace, loadDraft } from './draft';
import { deskDatabase } from './storage';

interface SignalRow {
  id: number;
  snapshot: string;
  published_at: string;
}

function publicationFromRow(row: SignalRow): PublishedSignal {
  return {
    id: `TRX-${String(row.id).padStart(4, '0')}`,
    card: JSON.parse(row.snapshot) as SignalCardData,
    publishedAt: row.published_at,
  };
}

function findPublication(revision: number): PublishedSignal | null {
  const row = deskDatabase().query<SignalRow, [string, number]>(`
    SELECT id, snapshot, published_at FROM published_signals
    WHERE workspace = ? AND draft_revision = ?
  `).get(draftWorkspace, revision);

  return row ? publicationFromRow(row) : null;
}

export function loadDraftPreview() {
  const draft = loadDraft();
  return {
    revision: draft.revision,
    card: signalCardFromDraft(draft.fields),
    review: draft.review,
    published: findPublication(draft.revision),
  };
}

export type DraftPreview = ReturnType<typeof loadDraftPreview>;

export function listPublishedSignals(): PublishedSignal[] {
  const rows = deskDatabase().query<SignalRow, []>(`
    SELECT id, snapshot, published_at FROM published_signals ORDER BY id DESC
  `).all();

  return rows.map(publicationFromRow);
}

function publicationBlock(review: SignalReview): string {
  const failed = review.checks.find(check => check.status === 'fail');
  if (failed) return failed.detail;
  if (review.missing.length > 0) return `Complete these fields before publishing: ${review.missing.join(', ')}.`;
  return review.checks.find(check => check.status === 'pending')?.detail ?? 'Complete the draft checks before publishing.';
}

export function publishSavedDraft(revision: number, publisherId: string) {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return { ok: false, message: 'Save the draft before publishing.' } as const;
  }

  const database = deskDatabase();
  // Keep the revision check, validation, and snapshot write under one write lock.
  // Retrying the same revision returns the original publication and ID.
  return database.transaction(() => {
    const existing = findPublication(revision);
    if (existing) return { ok: true, signal: existing } as const;

    const draft = loadDraft();
    if (draft.revision !== revision) {
      return { ok: false, message: 'The draft changed after you opened the preview. Reload the preview to review the latest version.' } as const;
    }
    if (draft.review.verdict !== 'Price checks complete') {
      return { ok: false, message: publicationBlock(draft.review) } as const;
    }

    const snapshot = JSON.stringify(signalCardFromDraft(draft.fields));
    const row = database.query<SignalRow, [string, number, string, string, string]>(`
      INSERT INTO published_signals (workspace, draft_revision, snapshot, published_at, published_by)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, snapshot, published_at
    `).get(draftWorkspace, revision, snapshot, new Date().toISOString(), publisherId);

    if (!row) throw new Error('Publishing did not return a signal');
    return { ok: true, signal: publicationFromRow(row) } as const;
  }).immediate();
}
