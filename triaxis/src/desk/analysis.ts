// An analysis is one trade idea by one analyst, from first draft to posted signal. These types
// travel from the server to the desk pages; `server/desk/analyses.ts` builds them.
import type { PublishedSignal } from '../signals/signal-card';
import type { SignalFields } from './draft/model/signal-fields';
import type { SignalReview } from './draft/model/signal-review';

export type StaffRole = 'admin' | 'analyst';

/** A member of staff, as the desk shows them. */
export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
}

/**
 * Where an analysis stands. Posted analyses are final. Otherwise the saved checks decide:
 * any failed check rejects it, anything missing leaves it incomplete, and a full pass makes
 * it ready to post.
 */
export type AnalysisStatus = 'posted' | 'ready' | 'rejected' | 'incomplete';

export const statusLabels: Record<AnalysisStatus, string> = {
  posted: 'Posted',
  ready: 'Ready to post',
  rejected: 'Rejected',
  incomplete: 'Incomplete',
};

export function statusOf(review: SignalReview, posted: boolean): AnalysisStatus {
  if (posted) return 'posted';
  if (review.verdict === 'Rejected') return 'rejected';
  return review.verdict === 'Price checks complete' ? 'ready' : 'incomplete';
}

/** A row in the central list. */
export interface AnalysisSummary {
  id: number;
  author: StaffMember;
  axis: string;
  symbol: string;
  direction: string;
  status: AnalysisStatus;
  /** What a rejected or incomplete analysis still needs, in one line. */
  attention: string;
  signalId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One analysis, opened in the editor. */
export interface AnalysisDetail {
  id: number;
  author: StaffMember;
  fields: SignalFields;
  revision: number;
  review: SignalReview;
  status: AnalysisStatus;
  published: PublishedSignal | null;
  createdAt: string;
  updatedAt: string;
}

/** Whether `viewer` may change or post `analysis`: its author, or an admin. */
export function canEdit(viewer: StaffMember, author: StaffMember): boolean {
  return viewer.role === 'admin' || viewer.id === author.id;
}

/** Up to two initials for a staff badge: "Ama Mensah" → "AM". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts.at(-1)!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** One of six badge colours, the same for a person every time: `0` to `5`. */
export function badgeTone(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return String(hash % 6);
}

/** The label an analysis is known by on the desk: "A-0012". */
export function analysisLabel(id: number): string {
  return `A-${String(id).padStart(4, '0')}`;
}
