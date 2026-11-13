import { preview } from '../preview';
import type { Member } from './api';

const members: Member[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Engineer' },
  { id: 2, name: 'Grace Hopper', role: 'Admiral' },
  { id: 3, name: 'Alan Turing', role: 'Researcher' },
];

// A small in-memory API for the pages' `$fetch` calls. A missing id answers 404.
await preview(new URL('./', import.meta.url), 'Team', 3032, {
  routes: true,
  api(request) {
    const url = new URL(request.url);
    const one = /^\/api\/people\/(\d+)$/.exec(url.pathname);
    if (one !== null) {
      const member = members.find((entry) => entry.id === Number(one[1]));
      return member === undefined ? new Response('missing', { status: 404 }) : Response.json(member);
    }
    if (url.pathname === '/api/people') {
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      return Response.json(members.filter((member) => member.name.toLowerCase().includes(search)));
    }
    return undefined;
  },
});
