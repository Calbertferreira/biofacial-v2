import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

if (!process.env.DATABASE_URL || !process.env.ADMIN_API_KEY || !process.env.SCANNER_API_KEY || !process.env.FACE_ENGINE_TOKEN) {
  throw new Error('Configure DATABASE_URL, ADMIN_API_KEY, SCANNER_API_KEY e FACE_ENGINE_TOKEN no .env');
}

const faceImage = Buffer.from('fixture-face-convidado-e2e').toString('base64');
const unknownImage = Buffer.from('fixture-face-desconhecido').toString('base64');
let enrolledProfileId;
const pg = createRequire(resolve('apps/api/package.json'))('pg');
const mockDb = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const faceServer = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.FACE_ENGINE_TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  response.setHeader('content-type', 'application/json');
  if (request.url === '/v1/verify-or-enroll') {
    const guest = await mockDb.query('SELECT email, phone_e164 FROM guests WHERE id = $1 AND event_id = $2', [body.guestId, body.eventId]);
    const existing = await mockDb.query("SELECT profile_id FROM person_face_contacts WHERE kind = 'email' AND value = lower($1) LIMIT 1", [guest.rows[0].email]);
    if (existing.rowCount && body.imageBase64 !== faceImage) {
      response.writeHead(409).end(JSON.stringify({ detail: 'face_mismatch' }));
      return;
    }
    const profileId = existing.rows[0]?.profile_id ?? (body.imageBase64 === faceImage && enrolledProfileId ? enrolledProfileId : body.guestId);
    if (!existing.rowCount) {
      if (profileId === body.guestId) await mockDb.query("INSERT INTO person_face_profiles (id, embedding_ciphertext, image_ciphertext, model) VALUES ($1, decode('00', 'hex'), decode('00', 'hex'), 'test-model')", [profileId]);
      await mockDb.query("INSERT INTO person_face_contacts (kind, value, profile_id) VALUES ('email', lower($1), $2)", [guest.rows[0].email, profileId]);
    }
    if (body.imageBase64 === faceImage) enrolledProfileId = profileId;
    response.end(JSON.stringify({ profileId, result: profileId === body.guestId ? 'enrolled' : 'matched' }));
  } else if (request.url === '/v1/identify') {
    response.end(JSON.stringify(body.imageBase64 === faceImage && enrolledProfileId
      ? { status: 'match', profileId: enrolledProfileId, confidence: 0.99 }
      : { status: 'no_match' }));
  } else {
    response.writeHead(422).end(JSON.stringify({ error: 'invalid_capture' }));
  }
});

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function call(base, path, { method = 'GET', key, body, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (response.status !== expected) throw new Error(`${method} retornou ${response.status}, esperado ${expected}: ${JSON.stringify(data)}`);
  return data;
}

let api;
try {
  faceServer.listen(0, '127.0.0.1');
  await once(faceServer, 'listening');
  const facePort = faceServer.address().port;
  const apiPort = await freePort();
  const base = `http://127.0.0.1:${apiPort}`;
  api = spawn(process.execPath, [resolve('apps/api/dist/server.js')], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(apiPort), FACE_ENGINE_URL: `http://127.0.0.1:${facePort}`,
      RESEND_API_KEY: '', WHATSAPP_ACCESS_TOKEN: '' },
    stdio: 'ignore',
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (api.exitCode !== null) throw new Error('A API encerrou durante a inicialização');
    try {
      const health = await call(base, '/health');
      if (health.status === 'ok') { ready = true; break; }
    } catch { /* aguarda a API e o Neon */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  if (!ready) throw new Error('A API não ficou pronta em 30 segundos');

  const now = Date.now();
  const event = await call(base, '/v1/events', {
    method: 'POST', key: process.env.ADMIN_API_KEY, expected: 201,
    body: {
      name: `E2E BioFacial ${new Date(now).toISOString()}`,
      startsAt: new Date(now - 5 * 60_000).toISOString(),
      endsAt: new Date(now + 15 * 60_000).toISOString(),
      timezone: 'America/Sao_Paulo', venue: 'Ambiente de testes',
    },
  });
  const guest = await call(base, `/v1/events/${event.id}/guests`, {
    method: 'POST', key: process.env.ADMIN_API_KEY, expected: 201,
    body: { name: 'Convidado E2E', email: `e2e-${now}@example.invalid` },
  });
  const token = new URL(guest.invitationUrl).pathname.split('/').at(-1);
  const pending = await call(base, `/v1/invitations/${token}`);
  if (pending.invitationStatus !== 'registered' || pending.guestName !== 'Convidado E2E') throw new Error('Convite inicial incorreto');
  await call(base, `/v1/invitations/${token}/accept`, {
    method: 'POST', body: { consent: true }, expected: 422,
  });

  const accepted = await call(base, `/v1/invitations/${token}/accept`, {
    method: 'POST', body: { consent: true, imageBase64: faceImage },
  });
  if (accepted.status !== 'accepted' || accepted.guestId !== guest.id) throw new Error('Aceite incorreto');
  const invitation = await call(base, `/v1/invitations/${token}`);
  if (invitation.invitationStatus !== 'accepted') throw new Error('Convite não foi atualizado');
  const changedEvent = await call(base, `/v1/events/${event.id}`, {
    method: 'PATCH', key: process.env.ADMIN_API_KEY,
    body: { venue: 'Novo local de testes', reason: 'Mudança de local para verificar a reconfirmação.' },
  });
  if (changedEvent.revision !== 2 || changedEvent.reconfirmationCount !== 1 || !changedEvent.notificationRequired) {
    throw new Error('Mudança não exigiu reconfirmação e aviso');
  }
  const pendingAgain = await call(base, `/v1/invitations/${token}`);
  if (pendingAgain.invitationStatus !== 'reconfirmation_pending' || !pendingAgain.hasStoredImage || pendingAgain.venue !== 'Novo local de testes') {
    throw new Error('Convite alterado não mostrou a necessidade de reconfirmação');
  }
  const notice = await call(base, `/v1/events/${event.id}/invitations/send`, {
    method: 'POST', key: process.env.ADMIN_API_KEY,
    body: { guestIds: [guest.id], channels: ['email'], purpose: 'event_change' },
  });
  if (notice.items[0].status !== 'failed' || notice.items[0].error !== 'email_not_configured') {
    throw new Error('Falha de aviso não foi mostrada ao operador');
  }
  await call(base, `/v1/events/${event.id}/activate`, { method: 'POST', key: process.env.ADMIN_API_KEY });
  const staleScan = await call(base, `/v1/events/${event.id}/scan`, {
    method: 'POST', key: process.env.SCANNER_API_KEY, body: { imageBase64: faceImage },
  });
  if (staleScan.action !== 'denied' || staleScan.reason !== 'reconfirmation_required') {
    throw new Error('Scanner liberou um aceite anterior à mudança');
  }
  const declined = await call(base, `/v1/invitations/${token}/decline`, { method: 'POST' });
  if (declined.status !== 'declined') throw new Error('Recusa da nova data não foi registrada');
  const reconfirmed = await call(base, `/v1/invitations/${token}/accept`, {
    method: 'POST', body: { consent: true },
  });
  if (reconfirmed.status !== 'accepted') throw new Error('Reconfirmação sem nova selfie falhou');
  const responses = await mockDb.query('SELECT event_revision, response FROM guest_responses WHERE guest_id = $1 ORDER BY responded_at, id', [guest.id]);
  if (responses.rows.length !== 3 || responses.rows.at(-1).event_revision !== 2) throw new Error('Histórico de respostas não foi preservado');

  const otherEvent = await call(base, '/v1/events', {
    method: 'POST', key: process.env.ADMIN_API_KEY, expected: 201,
    body: { name: `E2E Outro evento ${new Date(now).toISOString()}`,
      startsAt: new Date(now - 5 * 60_000).toISOString(), endsAt: new Date(now + 15 * 60_000).toISOString(),
      timezone: 'America/Sao_Paulo', venue: 'Ambiente de testes' },
  });
  const otherGuest = await call(base, `/v1/events/${otherEvent.id}/guests`, {
    method: 'POST', key: process.env.ADMIN_API_KEY, expected: 201,
    body: { name: 'Convidado E2E', email: `e2e-${now}@example.invalid` },
  });
  const otherToken = new URL(otherGuest.invitationUrl).pathname.split('/').at(-1);
  const otherInvitation = await call(base, `/v1/invitations/${otherToken}`);
  if (!otherInvitation.hasStoredImage || otherInvitation.invitationStatus !== 'registered') {
    throw new Error('Convite novo não reconheceu o cadastro facial existente');
  }
  await call(base, `/v1/invitations/${otherToken}/accept`, {
    method: 'POST', body: { consent: true },
  });
  const otherAccepted = await call(base, `/v1/invitations/${otherToken}`);
  if (otherAccepted.invitationStatus !== 'accepted' || !otherAccepted.hasStoredImage) throw new Error('Convite do segundo evento não reutilizou o cadastro');
  const thirdEvent = await call(base, '/v1/events', {
    method: 'POST', key: process.env.ADMIN_API_KEY, expected: 201,
    body: { name: `E2E Terceiro evento ${new Date(now).toISOString()}`,
      startsAt: new Date(now - 5 * 60_000).toISOString(), endsAt: new Date(now + 15 * 60_000).toISOString(),
      timezone: 'America/Sao_Paulo', venue: 'Ambiente de testes' },
  });
  const thirdGuest = await call(base, `/v1/events/${thirdEvent.id}/guests`, {
    method: 'POST', key: process.env.ADMIN_API_KEY, expected: 201,
    body: { name: 'Convidado E2E', email: `outro-e2e-${now}@example.invalid` },
  });
  const thirdToken = new URL(thirdGuest.invitationUrl).pathname.split('/').at(-1);
  await call(base, `/v1/invitations/${thirdToken}/accept`, {
    method: 'POST', body: { consent: true, imageBase64: faceImage },
  });
  const profiles = await mockDb.query(
    'SELECT count(DISTINCT person_face_id)::int AS total FROM guests WHERE id = ANY($1::uuid[])',
    [[guest.id, otherGuest.id, thirdGuest.id]],
  );
  if (profiles.rows[0].total !== 1) throw new Error('A mesma foto recebeu IDs diferentes ao mudar e-mail ou evento');
  await call(base, `/v1/events/${otherEvent.id}/guests/${otherGuest.id}`, {
    method: 'DELETE', key: process.env.ADMIN_API_KEY,
  });
  await call(base, `/v1/invitations/${otherToken}`, { expected: 404 });
  const otherList = await call(base, `/v1/events/${otherEvent.id}/guests`, { key: process.env.ADMIN_API_KEY });
  if (otherList.items.some(item => item.id === otherGuest.id)) throw new Error('Convidado excluído permaneceu na lista');
  await call(base, `/v1/events/${otherEvent.id}/activate`, { method: 'POST', key: process.env.ADMIN_API_KEY });
  const deletedGuestScan = await call(base, `/v1/events/${otherEvent.id}/scan`, {
    method: 'POST', key: process.env.SCANNER_API_KEY, body: { imageBase64: faceImage },
  });
  if (deletedGuestScan.action !== 'denied' || deletedGuestScan.reason !== 'not_invited' || deletedGuestScan.guestName !== guest.name) {
    throw new Error('Convidado conhecido sem vínculo ativo não recebeu a mensagem de não convidado');
  }

  await call(base, `/v1/events/${event.id}/scan`, {
    method: 'POST', body: { imageBase64: unknownImage }, expected: 401,
  });
  const denied = await call(base, `/v1/events/${event.id}/scan`, {
    method: 'POST', key: process.env.SCANNER_API_KEY, body: { imageBase64: unknownImage },
  });
  const entry = await call(base, `/v1/events/${event.id}/scan`, {
    method: 'POST', key: process.env.SCANNER_API_KEY, body: { imageBase64: faceImage },
  });
  const exit = await call(base, `/v1/events/${event.id}/scan`, {
    method: 'POST', key: process.env.SCANNER_API_KEY, body: { imageBase64: faceImage },
  });
  if (denied.action !== 'denied' || denied.reason !== 'no_match' || entry.action !== 'entry' || exit.action !== 'exit') throw new Error('Sequência de acesso incorreta');
  if (entry.guestId !== guest.id || exit.guestId !== guest.id) throw new Error('Identidade do convidado incorreta');
  const afterEntry = await call(base, `/v1/events/${event.id}/guests`, { key: process.env.ADMIN_API_KEY });
  if (afterEntry.items.find(item => item.id === guest.id)?.invitationStatus !== 'attended') throw new Error('Status de comparecimento não atualizado');
  const history = await call(base, `/v1/events/${event.id}/access-events`, { key: process.env.ADMIN_API_KEY });
  if (history.items.map(item => item.action).join(',') !== 'denied,denied,entry,exit') throw new Error('Histórico de acesso incorreto');
  const extension = await call(base, `/v1/events/${event.id}`, {
    method: 'PATCH', key: process.env.ADMIN_API_KEY,
    body: { endsAt: new Date(now + 30 * 60_000).toISOString(), reason: 'Ampliação do horário final do evento.' },
  });
  if (extension.revision !== 2 || extension.reconfirmationCount !== 0 || !extension.notificationRequired) {
    throw new Error('Ampliação do horário deve avisar sem exigir nova confirmação');
  }
  await call(base, `/v1/events/${event.id}`, {
    method: 'PATCH', key: process.env.ADMIN_API_KEY, expected: 409,
    body: { venue: 'Outro local', reason: 'Mudança depois de registrar entradas.' },
  });
  await call(base, `/v1/events/${thirdEvent.id}/cancel`, {
    method: 'POST', key: process.env.ADMIN_API_KEY,
    body: { reason: 'Cancelamento de teste após o envio de convites.' },
  });
  const cancelledInvitation = await call(base, `/v1/invitations/${thirdToken}`);
  if (cancelledInvitation.eventStatus !== 'cancelled') throw new Error('Convite não mostrou o cancelamento');
  const cancellationNotice = await call(base, `/v1/events/${thirdEvent.id}/invitations/send`, {
    method: 'POST', key: process.env.ADMIN_API_KEY,
    body: { guestIds: [thirdGuest.id], channels: ['email'], purpose: 'event_cancelled' },
  });
  if (cancellationNotice.items[0].status !== 'failed' || cancellationNotice.items[0].error !== 'email_not_configured') {
    throw new Error('Falha do aviso de cancelamento não foi registrada');
  }
  await call(base, `/v1/invitations/${thirdToken}/accept`, {
    method: 'POST', body: { consent: true }, expected: 409,
  });
  const disposable = await call(base, '/v1/events', {
    method: 'POST', key: process.env.ADMIN_API_KEY, expected: 201,
    body: { name: 'Rascunho descartável', startsAt: new Date(now + 60_000).toISOString(),
      endsAt: new Date(now + 120_000).toISOString(), timezone: 'America/Sao_Paulo', venue: 'Teste' },
  });
  await call(base, `/v1/events/${disposable.id}`, { method: 'DELETE', key: process.env.ADMIN_API_KEY });
  await call(base, `/v1/events/${disposable.id}`, { key: process.env.ADMIN_API_KEY, expected: 404 });

  console.log(JSON.stringify({ result: 'passed', eventId: event.id, guestId: guest.id, invitation: invitation.invitationStatus, access: history.items.map(item => item.action) }));
} finally {
  api?.kill();
  faceServer.close();
  await mockDb.end();
}
