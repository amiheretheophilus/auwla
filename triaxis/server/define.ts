import { createDefine } from '@memoized-dom/server';
import type { StaffMember } from '../src/desk/analysis';
import type { Member } from '../src/members/membership';

/** Per-request state. The guards in `auth/guards.ts` fill it in before a function runs. */
export interface RequestState {
  /** The signed-in member of staff, set by `requireStaff`. */
  staff: StaffMember | null;
  /** The signed-in person, member or staff, set by `requireMember`. */
  member: Member | null;
}

export const define = createDefine<RequestState>();

export function emptyRequestState(): RequestState {
  return { staff: null, member: null };
}
