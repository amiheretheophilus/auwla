import { getMigrations } from 'better-auth/db/migration';
import { deskDatabase } from '../desk/storage';
import { getAuth } from './auth';

const email = process.env.TRIAXIS_ANALYST_EMAIL?.trim().toLowerCase();
const password = process.env.TRIAXIS_ANALYST_PASSWORD;
if (!email || !password || password.length < 12 || password.length > 128) {
  throw new Error('Set TRIAXIS_ANALYST_EMAIL and a 12–128 character TRIAXIS_ANALYST_PASSWORD in triaxis/.env');
}

const auth = getAuth();
const migration = await getMigrations(auth.options);
await migration.runMigrations();

const existing = deskDatabase().query<{ role: string | null }, [string]>(`
  SELECT role FROM "user" WHERE email = ?
`).get(email);

if (existing) {
  if (existing.role !== 'admin') throw new Error('The configured email is already registered without staff access');
  console.log('The local staff account is ready.');
} else {
  await auth.api.createUser({
    body: { email, password, name: 'Triaxis Analyst', role: 'admin' },
  });
  console.log('Created the local staff account.');
}
