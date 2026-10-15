import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória');

const pg = createRequire(resolve('apps/api/package.json'))('pg');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ids = [];
let api;

async function createEvent(status, endsAt) {
  const result = await db.query(
    `INSERT INTO events (name, starts_at, ends_at, timezone, venue, status)
     VALUES ($1, $2, $3, 'America/Sao_Paulo', 'Teste automático', $4) RETURNING id`,
    [`Teste encerramento automático ${Date.now()}`, new Date(endsAt.getTime() - 60_000), endsAt, status],
  );
  const id = result.rows[0].id;
  ids.push(id);
  return id;
}

async function state(id) {
  const result = await db.query(
    `SELECT e.status, count(a.id)::int AS audit_count
       FROM events e LEFT JOIN audit_events a
         ON a.event_id = e.id AND a.action = 'event_auto_finished'
      WHERE e.id = $1 GROUP BY e.id`, [id],
  );
  return result.rows[0];
}

try {
  const expired = await createEvent('draft', new Date(Date.now() - 2_000));
  const cancelled = await createEvent('cancelled', new Date(Date.now() - 2_000));
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  probe.close();
  await once(probe, 'close');

  api = spawn(process.execPath, [resolve('apps/api/dist/server.js')], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: 'ignore',
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (api.exitCode !== null) throw new Error('A API encerrou durante a inicialização');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) { ready = true; break; }
    } catch { /* aguarda inicialização */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  if (!ready) throw new Error('A API não iniciou');
  if ((await state(expired)).status !== 'finished' || (await state(expired)).audit_count !== 1) {
    throw new Error('Evento vencido não foi encerrado na inicialização');
  }
  if ((await state(cancelled)).status !== 'cancelled' || (await state(cancelled)).audit_count !== 0) {
    throw new Error('Evento cancelado foi modificado');
  }

  const scheduled = await createEvent('active', new Date(Date.now() + 2_000));
  let finished = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await state(scheduled);
    if (current.status === 'finished') {
      if (current.audit_count !== 1) throw new Error('Encerramento automático registrou auditoria duplicada');
      finished = true;
      break;
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  if (!finished) throw new Error('Evento não foi encerrado após o horário previsto');
  console.log(JSON.stringify({ result: 'passed', startup: true, scheduled: true, cancelledPreserved: true }));
} finally {
  if (api && api.exitCode === null) {
    const exited = once(api, 'exit');
    api.kill();
    await exited;
  }
  if (ids.length) {
    await db.query('DELETE FROM audit_events WHERE event_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [ids]);
  }
  await db.end();
}
