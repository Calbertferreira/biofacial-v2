import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED ou DATABASE_URL é obrigatório');
const client = new pg.Client({ connectionString });
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('biofacial_migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(migrationsDir)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of files) {
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (existing.rowCount) continue;
    await client.query(await readFile(join(migrationsDir, name), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    console.log(`Migração ${name} aplicada.`);
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
