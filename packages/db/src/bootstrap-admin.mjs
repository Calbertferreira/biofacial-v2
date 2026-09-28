import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const scrypt = promisify(scryptCallback);
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Conexão de banco não configurada');
const email = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? 'admin@biofacial.local').trim().toLowerCase();
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16).toString('hex');
const derived = await scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
const passwordHash = `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`;
const destination = fileURLToPath(new URL('../../../.bootstrap-admin.txt', import.meta.url));
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('biofacial_bootstrap_admin'))");
  const existing = await client.query(`SELECT id FROM app_users WHERE role = 'adm' LIMIT 1`);
  if (existing.rowCount) {
    await client.query('ROLLBACK');
    console.log('Já existe um administrador. Nenhuma conta foi criada.');
  } else {
    const inserted = await client.query(
      `INSERT INTO app_users (name, email, password_hash, role, must_change_password)
       VALUES ('Administrador Principal', $1, $2, 'adm', true) RETURNING id`, [email, passwordHash],
    );
    await writeFile(destination, `BioFacial v2 — administrador inicial\nEmail: ${email}\nSenha temporária: ${password}\nTroque a senha no primeiro acesso. Apague este arquivo após guardar a nova credencial.\n`, { flag: 'wx', mode: 0o600 });
    await client.query('COMMIT');
    console.log(`Administrador inicial criado: ${inserted.rows[0].id}. Credenciais guardadas no arquivo local ignorado pelo Git.`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
