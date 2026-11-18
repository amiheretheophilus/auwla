import type { PublishedSignal, SignalCardData } from '../../src/signals/signal-card';
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

/** Every posted signal, newest first, for the members' feed. Posting lives in `analyses.ts`. */
export function listPublishedSignals(): PublishedSignal[] {
  const rows = deskDatabase().query<SignalRow, []>(`
    SELECT id, snapshot, published_at FROM published_signals ORDER BY id DESC
  `).all();

  return rows.map(publicationFromRow);
}
