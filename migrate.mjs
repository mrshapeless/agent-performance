import pg from 'pg';
import { readFile } from 'node:fs/promises';

// Never mutate production state from preview builds.
if (process.env.VERCEL_ENV === 'preview') {
  console.log('Preview: migration skipped.');
} else {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(730201)');
    await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
    console.log('Schema v1 ready.');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw Error('Migration failed; check database configuration.');
  } finally { client.release(); await pool.end(); }
}
