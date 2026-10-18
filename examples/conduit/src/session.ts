import { $track } from '@memoized-dom/data';
import { getMe } from '#server-functions';

/** The signed-in reader, shared by every page. */
export const me = getMe();

export function signIn(username: string): void {
  document.cookie = `conduit_user=${encodeURIComponent(username)}; path=/; max-age=2592000; samesite=lax`;
  $track(me).refresh();
}

export function signOut(): void {
  document.cookie = 'conduit_user=; path=/; max-age=0';
  $track(me).refresh();
}
