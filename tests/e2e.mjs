import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

if (!process.env.DATABASE_URL || !process.env.ADMIN_API_KEY || !process.env.SCANNER_API_KEY || !process.env.FACE_ENGINE_TOKEN) {
  throw new Error('Configure DATABASE_URL, ADMIN_API_KEY, SCANNER_API_KEY e FACE_ENGINE_TOKEN no .env');
}

const faceImage = Buffer.from('fixture-face-convidado-e2e').toString('base64');
const unknownImage = Buffer.from('fixture-face-desconhecido').toString('base64');
let enrolledGuestId;
let enrolledEventId;

const faceServer = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.FACE_ENGINE_TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  response.setHeader('content-type', 'application/json');
  if (request.url === '/v1/enroll' && body.imageBase64 === faceImage) {
    enrolledGuestId = body.guestId;
    enrolledEventId = body.eventId;
    response.end(JSON.stringify({ profileId: `test-${enrolledGuestId}` }));
  } else if (request.url === '/v1/identify') {
    response.end(JSON.stringify(body.imageBase64 === faceImage && body.eventId === enrolledEventId && enrolledGuestId
      ? { status: 'match', guestId: enrolledGuestId, confidence: 0.99 }
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
    env: { ...process.env, PORT: String(apiPort), FACE_ENGINE_URL: `http://127.0.0.1:${facePort}` },
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

  const accepted = await call(base, `/v1/invitations/${token}/accept`, {
    method: 'POST', body: { consent: true, imageBase64: faceImage },
  });
  if (accepted.status !== 'accepted' || accepted.guestId !== guest.id) throw new Error('Aceite incorreto');
  const invitation = await call(base, `/v1/invitations/${token}`);
  if (invitation.invitationStatus !== 'accepted') throw new Error('Convite não foi atualizado');

  await call(base, `/v1/events/${event.id}/activate`, { method: 'POST', key: process.env.ADMIN_API_KEY });
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
  if (denied.action !== 'denied' || entry.action !== 'entry' || exit.action !== 'exit') throw new Error('Sequência de acesso incorreta');
  if (entry.guestId !== guest.id || exit.guestId !== guest.id) throw new Error('Identidade do convidado incorreta');
  const afterEntry = await call(base, `/v1/events/${event.id}/guests`, { key: process.env.ADMIN_API_KEY });
  if (afterEntry.items.find(item => item.id === guest.id)?.invitationStatus !== 'attended') throw new Error('Status de comparecimento não atualizado');
  const history = await call(base, `/v1/events/${event.id}/access-events`, { key: process.env.ADMIN_API_KEY });
  if (history.items.map(item => item.action).join(',') !== 'denied,entry,exit') throw new Error('Histórico de acesso incorreto');

  console.log(JSON.stringify({ result: 'passed', eventId: event.id, guestId: guest.id, invitation: invitation.invitationStatus, access: history.items.map(item => item.action) }));
} finally {
  api?.kill();
  faceServer.close();
}
