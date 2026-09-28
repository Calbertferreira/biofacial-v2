import pg from 'pg';

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Conexão de banco não configurada');
const client = new pg.Client({ connectionString });
const expected = ['access_events', 'app_users', 'audit_events', 'clients', 'events', 'guests', 'schema_migrations', 'user_clients', 'user_sessions'];
await client.connect();
try {
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [expected],
  );
  const found = result.rows.map(row => row.table_name);
  if (found.join(',') !== expected.join(',')) throw new Error(`Tabelas esperadas: ${expected.join(', ')}; encontradas: ${found.join(', ')}`);
  console.log(`Estrutura confirmada: ${found.join(', ')}.`);
  const users = await client.query(`SELECT role, count(*)::int AS total FROM app_users WHERE active GROUP BY role ORDER BY role`);
  console.log(`Usuários ativos por papel: ${users.rows.map(row => `${row.role}=${row.total}`).join(', ') || 'nenhum'}.`);
} finally {
  await client.end();
}
