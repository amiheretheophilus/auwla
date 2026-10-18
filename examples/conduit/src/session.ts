import { $track } from '@memoized-dom/data';
import { getMe, logout } from '#server-functions';

/** The signed-in reader, shared by every page. */
export const me = getMe();

/** The server set the session cookie; re-read who is signed in. */
export function signedIn(): void {
  $track(me).refresh();
}

export function signOut(): void {
  $track(logout()).onSuccess(() => $track(me).refresh());
}
