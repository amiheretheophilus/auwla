// Analyses: every analyst's trade ideas, from first draft to posted signal. The checks run here
// on every save and again inside the posting transaction, so what the browser shows is never the
// authority. Posting writes a published_signals row whose UNIQUE (workspace, draft_revision)
// key makes a repeated Post return the first signal instead of making a second one.
import {
  canEdit,
  statusOf,
  type AnalysisDetail,
  type AnalysisSummary,
  type StaffMember,
} from '../../src/desk/analysis';
import { inspectSignal, isOptionalRiskPercentage, readSignalFields } from '../../src/desk/draft/model/signal-checks';
import { emptyFields } from '../../src/desk/draft/model/signal-fields';
import type { SignalReview } from '../../src/desk/draft/model/signal-review';
import { signalCardFromDraft, type PublishedSignal, type SignalCardData } from '../../src/signals/signal-card';
import { isStaffRole } from '../auth/auth';
import { deskDatabase } from './storage';

interface AnalysisRow {
  id: number;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  author_role: string | null;
  revision: number;
  fields: string;
  verdict: string;
  created_at: string;
  updated_at: string;
  signal_id: number | null;
  signal_snapshot: string | null;
  signal_published_at: string | null;
}

// Each analysis with its author and, once posted, its signal.
const selectAnalyses = `
  SELECT a.id, a.author_id, a.revision, a.fields, a.verdict, a.created_at, a.updated_at,
         u.name AS author_name, u.email AS author_email, u.role AS author_role,
         s.id AS signal_id, s.snapshot AS signal_snapshot, s.published_at AS signal_published_at
  FROM analyses a
  LEFT JOIN "user" u ON u.id = a.author_id
  LEFT JOIN published_signals s ON s.workspace = 'analysis:' || a.id
`;

function workspaceOf(id: number) {
  return `analysis:${id}`;
}

function signalLabel(id: number) {
  return `TRX-${String(id).padStart(4, '0')}`;
}

function authorOf(row: AnalysisRow): StaffMember {
  return {
    id: row.author_id,
    name: row.author_name || row.author_email || 'Former staff member',
    role: isStaffRole(row.author_role) ? row.author_role : 'analyst',
  };
}

function publicationOf(row: AnalysisRow): PublishedSignal | null {
  if (row.signal_id === null || row.signal_snapshot === null || row.signal_published_at === null) return null;
  return {
    id: signalLabel(row.signal_id),
    card: JSON.parse(row.signal_snapshot) as SignalCardData,
    publishedAt: row.signal_published_at,
  };
}

function reviewOf(row: AnalysisRow) {
  const fields = readSignalFields(JSON.parse(row.fields));
  if (!fields) throw new Error(`Analysis ${row.id} has invalid stored fields`);
  return { fields, review: inspectSignal(fields) };
}

/** What a rejected or incomplete analysis still needs, as one line for the list. */
function attentionOf(review: SignalReview): string {
  const failed = review.checks.find(check => check.status === 'fail');
  if (failed) return failed.detail;
  if (review.missing.length > 0) return `Missing ${review.missing.join(', ').toLowerCase()}.`;
  const pending = review.checks.find(check => check.status === 'pending');
  if (pending) return pending.detail;
  const warning = review.checks.find(check => check.status === 'warning');
  return warning ? warning.detail : 'All price checks pass.';
}

export function listAnalyses(): AnalysisSummary[] {
  const rows = deskDatabase().query<AnalysisRow, []>(`${selectAnalyses} ORDER BY a.updated_at DESC`).all();
  return rows.map(row => {
    const { fields, review } = reviewOf(row);
    const published = publicationOf(row);
    return {
      id: row.id,
      author: authorOf(row),
      axis: fields.axis,
      symbol: fields.symbol,
      direction: fields.direction,
      status: statusOf(review, published !== null),
      attention: published ? `Posted as ${published.id}.` : attentionOf(review),
      signalId: published?.id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/** Everyone who has written an analysis, plus the viewer, for the list's analyst filter. */
export function listAuthors(viewer: StaffMember): StaffMember[] {
  const rows = deskDatabase().query<{ id: string; name: string | null; email: string; role: string | null }, []>(`
    SELECT id, name, email, role FROM "user" WHERE role IN ('admin', 'analyst') ORDER BY name
  `).all();
  const staff = rows.map(row => ({
    id: row.id,
    name: row.name || row.email,
    role: isStaffRole(row.role) ? row.role : 'analyst' as const,
  }));
  return staff.some(member => member.id === viewer.id) ? staff : [viewer, ...staff];
}

export function loadAnalysis(id: number): AnalysisDetail | null {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const row = deskDatabase().query<AnalysisRow, [number]>(`${selectAnalyses} WHERE a.id = ?`).get(id);
  if (!row) return null;

  const { fields, review } = reviewOf(row);
  const published = publicationOf(row);
  return {
    id: row.id,
    author: authorOf(row),
    fields,
    revision: row.revision,
    review,
    status: statusOf(review, published !== null),
    published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createAnalysis(author: StaffMember) {
  const now = new Date().toISOString();
  const fields = { ...emptyFields, targets: [...emptyFields.targets] };
  const row = deskDatabase().query<{ id: number }, [string, string, string, string, string]>(`
    INSERT INTO analyses (author_id, revision, fields, verdict, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, ?)
    RETURNING id
  `).get(author.id, JSON.stringify(fields), inspectSignal(fields).verdict, now, now);
  if (!row) throw new Error('Creating the analysis did not return an id');
  return { ok: true, id: row.id } as const;
}

/** Why `editor` cannot change analysis `detail`, or null when they can. */
function editBlock(detail: AnalysisDetail | null, editor: StaffMember): string | null {
  if (!detail) return 'This analysis no longer exists.';
  if (!canEdit(editor, detail.author)) return `Only ${detail.author.name} or an admin can change this analysis.`;
  if (detail.published) return `This analysis was posted as ${detail.published.id} and can no longer change.`;
  return null;
}

export function saveAnalysis(id: number, revision: number, input: unknown, editor: StaffMember) {
  const fields = readSignalFields(input);
  if (!fields || !Number.isSafeInteger(revision) || revision < 1) {
    return { ok: false, message: 'The analysis has invalid fields. Check the selected market and values.' } as const;
  }
  if (!isOptionalRiskPercentage(fields.risk)) {
    return { ok: false, message: 'Enter risk as a non-negative number or leave it blank.' } as const;
  }

  const database = deskDatabase();
  return database.transaction(() => {
    const blocked = editBlock(loadAnalysis(id), editor);
    if (blocked) return { ok: false, message: blocked } as const;

    const review = inspectSignal(fields);
    // The revision is checked in the same statement, so a stale tab cannot overwrite newer work.
    const result = database.query(`
      UPDATE analyses SET revision = revision + 1, fields = ?, verdict = ?, updated_at = ?
      WHERE id = ? AND revision = ?
    `).run(JSON.stringify(fields), review.verdict, new Date().toISOString(), id, revision);
    if (result.changes !== 1) {
      return { ok: false, message: 'Someone saved a newer version of this analysis. Copy any unsaved changes, then reload.' } as const;
    }

    return { ok: true, analysis: loadAnalysis(id)! } as const;
  }).immediate();
}

function postBlock(review: SignalReview): string {
  const failed = review.checks.find(check => check.status === 'fail');
  if (failed) return `Rejected: ${failed.detail}`;
  if (review.missing.length > 0) return `Complete these fields before posting: ${review.missing.join(', ')}.`;
  return review.checks.find(check => check.status === 'pending')?.detail ?? 'Complete the checks before posting.';
}

export function publishAnalysis(id: number, revision: number, publisher: StaffMember) {
  const database = deskDatabase();
  // The checks, the revision and the write share one write lock.
  return database.transaction(() => {
    const detail = loadAnalysis(id);
    if (detail?.published) return { ok: true, analysis: detail } as const;

    const blocked = editBlock(detail, publisher);
    if (blocked || !detail) return { ok: false, message: blocked ?? 'This analysis no longer exists.' } as const;
    if (detail.revision !== revision) {
      return { ok: false, message: 'The analysis changed since you opened it. Reload to post the latest version.' } as const;
    }
    if (detail.review.verdict !== 'Price checks complete') {
      return { ok: false, message: postBlock(detail.review) } as const;
    }

    database.query(`
      INSERT INTO published_signals (workspace, draft_revision, snapshot, published_at, published_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (workspace, draft_revision) DO NOTHING
    `).run(workspaceOf(id), revision, JSON.stringify(signalCardFromDraft(detail.fields)), new Date().toISOString(), publisher.id);

    return { ok: true, analysis: loadAnalysis(id)! } as const;
  }).immediate();
}
