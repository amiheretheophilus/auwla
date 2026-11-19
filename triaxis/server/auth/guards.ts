// Middleware for server function files: `export const middleware = [sameSite, requireStaff]`.
// A guard that refuses answers with `error()`, so the page's `$forms` shows the message.
import { error } from '@memoized-dom/server';
import type { StaffMember } from '../../src/desk/analysis';
import type { Member } from '../../src/members/membership';
import { define, type RequestState } from '../define';
import { getMember } from '../members/access';
import { getAnalyst } from './auth';
import { isSameOrigin } from './routes';

/** Only pages of this site may call the function. */
export const sameSite = define.middleware((context, next) => {
  if (!isSameOrigin(context.request)) {
    return error({ message: 'Use the Triaxis site for this.' }, { status: 403 });
  }

  return next();
});

/** A signed-in member of staff, stored on `state.staff`. */
export const requireStaff = define.middleware(async (context, next) => {
  const staff = await getAnalyst(context.request);
  if (!staff) {
    return error({ message: 'Your desk session has ended. Sign in again.' }, { status: 401 });
  }

  context.state.staff = staff;
  return next();
});

/** A signed-in person, member or staff, stored on `state.member`. */
export const requireMember = define.middleware(async (context, next) => {
  const signedIn = await getMember(context.request);
  if (!signedIn) {
    return error({ message: 'Your session has ended. Sign in again.' }, { status: 401 });
  }

  context.state.member = signedIn.member;
  return next();
});

/** `state.staff` in a function file whose middleware includes `requireStaff`. */
export function staffOf(state: RequestState): StaffMember {
  if (!state.staff) {
    throw new Error('requireStaff must run before this function');
  }
  return state.staff;
}

/** `state.member` in a function file whose middleware includes `requireMember`. */
export function memberOf(state: RequestState): Member {
  if (!state.member) {
    throw new Error('requireMember must run before this function');
  }
  return state.member;
}
