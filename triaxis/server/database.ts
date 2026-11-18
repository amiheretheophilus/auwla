import { neon } from '@neondatabase/serverless';

/** Initialize on demand so public pages and liveness can run independently of Neon. */
export function database() {
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    throw new Error('DATABASE_URL is required for database access');
  }

  return neon(url);
}

/** Keep connection errors and credentials out of the public readiness response. */
export async function databaseIsReady(): Promise<boolean> {
  try {
    const sql = database();
    await sql.query('SELECT 1', [], {
      fetchOptions: { signal: AbortSignal.timeout(5_000) },
    });
    return true;
  } catch {
    return false;
  }
}
