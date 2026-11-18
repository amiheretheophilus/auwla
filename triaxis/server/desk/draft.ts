import { emptyFields, type SignalFields } from '../../src/desk/draft/model/signal-fields';
import type { SignalDraft } from '../../src/desk/draft/model/signal-review';
import { inspectSignal, isOptionalRiskPercentage, readSignalFields } from './checks';
import { deskDatabase } from './storage';

export const draftWorkspace = 'local-analyst';

interface DraftRow {
  revision: number;
  fields: string;
  updated_at: string;
}

function draftResult(fields: SignalFields, revision: number, updatedAt: string | null): SignalDraft {
  return { fields, revision, updatedAt, review: inspectSignal(fields) };
}

export function loadDraft(): SignalDraft {
  const row = deskDatabase().query<DraftRow, [string]>(`
    SELECT revision, fields, updated_at FROM signal_drafts WHERE analyst = ?
  `).get(draftWorkspace);

  if (!row) return draftResult({ ...emptyFields }, 0, null);

  const fields = readSignalFields(JSON.parse(row.fields));
  if (!fields) throw new Error('The stored draft has invalid fields');
  return draftResult(fields, row.revision, row.updated_at);
}

export function writeDraft(input: unknown, revision: number) {
  const fields = readSignalFields(input);
  if (!fields || !Number.isSafeInteger(revision) || revision < 0) {
    return { ok: false, message: 'The draft has invalid fields. Check the selected market and values.' } as const;
  }
  if (!isOptionalRiskPercentage(fields.risk)) {
    return { ok: false, message: 'Enter risk as a non-negative number or leave it blank.' } as const;
  }

  const database = deskDatabase();
  const updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(fields);
  // The write checks the revision in the same SQL statement to prevent stale overwrites.
  const result = revision === 0
    ? database.query(`
        INSERT INTO signal_drafts (analyst, revision, fields, updated_at)
        VALUES (?, 1, ?, ?)
        ON CONFLICT (analyst) DO NOTHING
      `).run(draftWorkspace, serialized, updatedAt)
    : database.query(`
        UPDATE signal_drafts SET revision = revision + 1, fields = json_patch(fields, ?), updated_at = ?
        WHERE analyst = ? AND revision = ?
      `).run(serialized, updatedAt, draftWorkspace, revision);

  if (result.changes !== 1) {
    return { ok: false, message: 'Another tab saved a newer draft. Copy any unsaved changes, then reload.' } as const;
  }

  return { ok: true, draft: draftResult(fields, revision + 1, updatedAt) } as const;
}
