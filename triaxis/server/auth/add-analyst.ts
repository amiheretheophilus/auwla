// Adds a member of staff to the local desk.
//
//   bun run --cwd triaxis auth:add-analyst "Ama Mensah" ama@example.com
//   bun run --cwd triaxis auth:add-analyst "Kofi Boateng" kofi@example.com admin
//
// The password is asked for, so it stays out of the shell history. Analysts change their own
// analyses; admins can change any. Run `auth:setup` once first to create the auth tables.
import { deskDatabase } from '../desk/storage';
import { getAuth, isStaffRole } from './auth';

const [name, rawEmail, rawRole = 'analyst'] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!name?.trim() || !email || !email.includes('@') || !isStaffRole(rawRole)) {
  throw new Error('Usage: auth:add-analyst "<full name>" <email> [analyst|admin]');
}

const existing = deskDatabase().query<{ role: string | null }, [string]>(`
  SELECT role FROM "user" WHERE email = ?
`).get(email);
if (existing) throw new Error(`${email} already has an account (${existing.role ?? 'no role'}).`);

const password = prompt(`Password for ${email} (12 to 128 characters):`) ?? '';
if (password.length < 12 || password.length > 128) throw new Error('The password must be 12 to 128 characters.');

await getAuth().api.createUser({
  body: { email, password, name: name.trim(), role: rawRole },
});
console.log(`Added ${name.trim()} (${email}) as ${rawRole === 'admin' ? 'an admin' : 'an analyst'}.`);
