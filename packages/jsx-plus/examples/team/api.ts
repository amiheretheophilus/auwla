export type Member = { id: number; name: string; role: string };

/**
 * The people matching `search`. A function returning `$fetch` is a source too: the caller's
 * binding requests again whenever the argument changes, and keeps the old list on screen meanwhile.
 */
export function getPeople(search: string) {
  return $fetch<Member[]>('/api/people', { query: { search } });
}
