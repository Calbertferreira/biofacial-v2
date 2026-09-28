import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { once } from 'node:events';

const root = resolve('.');
const bootstrap = await readFile(resolve('.bootstrap-admin.txt'), 'utf8');
const adminEmail = bootstrap.match(/^Email: (.+)$/m)?.[1];
const adminPassword = bootstrap.match(/^Senha temporária: (.+)$/m)?.[1];
if (!adminEmail || !adminPassword || !process.env.ADMIN_API_KEY) throw new Error('Credenciais de teste ausentes');

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lHsAAAAASUVORK5CYII=', 'base64');
const imageBase64 = image.toString('base64');
const unknownImage = Buffer.from('outro-rosto-de-teste');
let enrolled;
const faceServer = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.FACE_ENGINE_TOKEN}`) return response.writeHead(401).end();
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  response.setHeader('content-type', 'application/json');
  if (request.url === '/v1/enroll') {
    enrolled = { guestId: body.guestId, eventId: body.eventId, imageBase64: body.imageBase64 };
    return response.end(JSON.stringify({ profileId: `rbac-test-${body.guestId}` }));
  }
  if (request.url === '/v1/identify') {
    return response.end(JSON.stringify(enrolled && body.eventId === enrolled.eventId && body.imageBase64 === enrolled.imageBase64
      ? { status: 'match', guestId: enrolled.guestId, confidence: 0.99 }
      : { status: 'no_match' }));
  }
  response.writeHead(404).end();
});

async function call(base, path, { method = 'GET', key, body, raw, contentType, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': contentType } : {}) },
    body: body ? JSON.stringify(body) : raw,
  });
  const data = await response.json();
  if (response.status !== expected) throw new Error(`${method} ${path.split('/').slice(0, 5).join('/')} retornou ${response.status}; esperado ${expected}: ${JSON.stringify(data)}`);
  return data;
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

let apiUrl;
let realApiUrl;
const testUsers = [];
let apiProcess;
let realApiProcess;
let adminKey = process.env.ADMIN_API_KEY;
try {
  faceServer.listen(0, '127.0.0.1');
  await once(faceServer, 'listening');
  const facePort = faceServer.address().port;
  const apiPort = await freePort();
  const realApiPort = await freePort();
  apiUrl = `http://127.0.0.1:${apiPort}`;
  realApiUrl = `http://127.0.0.1:${realApiPort}`;
  apiProcess = spawn(process.execPath, [resolve('apps/api/dist/server.js')], {
    cwd: root, env: { ...process.env, BROWSER_DEMO: 'true', PORT: String(apiPort), FACE_ENGINE_URL: `http://127.0.0.1:${facePort}` }, stdio: 'ignore',
  });
  realApiProcess = spawn(process.execPath, [resolve('apps/api/dist/server.js')], {
    cwd: root, env: { ...process.env, BROWSER_DEMO: 'false', PORT: String(realApiPort), FACE_ENGINE_URL: `http://127.0.0.1:${facePort}` }, stdio: 'ignore',
  });
  for (const base of [apiUrl, realApiUrl]) {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await call(base, '/health')).status === 'ok') { ready = true; break; } } catch { /* aguarda */ }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    }
    if (!ready) throw new Error('API de teste não iniciou');
  }

  const firstAdmin = await call(realApiUrl, '/v1/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  if (firstAdmin.user.role !== 'adm' || !firstAdmin.user.mustChangePassword) throw new Error('Bootstrap adm incorreto');
  await call(realApiUrl, '/v1/clients', { method: 'POST', key: firstAdmin.accessToken, body: { name: 'Bloqueado' }, expected: 403 });
  await call(realApiUrl, '/v1/auth/logout', { method: 'POST', key: firstAdmin.accessToken });

  const suffix = randomBytes(5).toString('hex');
  const clientA = await call(apiUrl, '/v1/clients', { method: 'POST', key: adminKey, expected: 201, body: { name: `E2E RBAC Cliente A ${suffix}`, externalId: `e2e-a-${suffix}` } });
  const clientB = await call(apiUrl, '/v1/clients', { method: 'POST', key: adminKey, expected: 201, body: { name: `E2E RBAC Cliente B ${suffix}`, externalId: `e2e-b-${suffix}` } });
  const temp = `Temp-${randomBytes(12).toString('hex')}`;
  const staff = await call(apiUrl, '/v1/users', { method: 'POST', key: adminKey, expected: 201, body: { name: 'Staff E2E', email: `staff-${suffix}@example.invalid`, role: 'staff', temporaryPassword: temp } });
  testUsers.push(staff.id);
  const manager = await call(apiUrl, '/v1/users', { method: 'POST', key: adminKey, expected: 201, body: { name: 'Gestor E2E', email: `gestor-${suffix}@example.invalid`, role: 'gestor', clientIds: [clientA.id], temporaryPassword: temp } });
  testUsers.push(manager.id);

  async function activateUser(email) {
    const login = await call(apiUrl, '/v1/auth/login', { method: 'POST', body: { email, password: temp } });
    if (!login.user.mustChangePassword) throw new Error('Senha temporária não exigiu troca');
    const newPassword = `Nova-${randomBytes(12).toString('hex')}`;
    await call(apiUrl, '/v1/auth/change-password', { method: 'POST', key: login.accessToken, body: { currentPassword: temp, newPassword } });
    const active = await call(apiUrl, '/v1/auth/login', { method: 'POST', body: { email, password: newPassword } });
    if (active.user.mustChangePassword) throw new Error('Troca de senha não persistiu');
    return active.accessToken;
  }
  const staffToken = await activateUser(staff.email);
  const managerToken = await activateUser(manager.email);

  const staffClients = await call(apiUrl, '/v1/clients', { key: staffToken });
  if (!staffClients.items.some(c => c.id === clientA.id) || !staffClients.items.some(c => c.id === clientB.id)) throw new Error('Staff não consultou todos os clientes');
  await call(apiUrl, '/v1/clients', { method: 'POST', key: staffToken, body: { name: 'Proibido' }, expected: 403 });
  await call(apiUrl, '/v1/users', { method: 'POST', key: staffToken, body: { name: 'Proibido', email: `x-${suffix}@example.invalid`, role: 'staff', temporaryPassword: temp }, expected: 403 });

  const managerClients = await call(apiUrl, '/v1/clients', { key: managerToken });
  if (managerClients.items.length !== 1 || managerClients.items[0].id !== clientA.id) throw new Error('Escopo do gestor incorreto');
  await call(apiUrl, '/v1/users', { method: 'POST', key: managerToken, body: { name: 'Proibido', email: `y-${suffix}@example.invalid`, role: 'staff', temporaryPassword: temp }, expected: 403 });
  await call(apiUrl, '/v1/users', { method: 'POST', key: managerToken, body: { name: 'Proibido', email: `z-${suffix}@example.invalid`, role: 'gestor', clientIds: [clientB.id], temporaryPassword: temp }, expected: 403 });
  const child = await call(apiUrl, '/v1/users', { method: 'POST', key: managerToken, expected: 201, body: { name: 'Gestor Filho E2E', email: `filho-${suffix}@example.invalid`, role: 'gestor', clientIds: [clientA.id], temporaryPassword: temp } });
  testUsers.push(child.id);

  const now = Date.now();
  const eventBody = { name: `E2E RBAC Evento ${suffix}`, venue: 'Teste', timezone: 'America/Sao_Paulo', startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 60 * 60_000).toISOString() };
  await call(apiUrl, '/v1/events', { method: 'POST', key: managerToken, body: { ...eventBody, clientId: clientB.id }, expected: 403 });
  const event = await call(apiUrl, '/v1/events', { method: 'POST', key: managerToken, expected: 201, body: { ...eventBody, clientId: clientA.id } });
  const otherEvent = await call(apiUrl, '/v1/events', { method: 'POST', key: adminKey, expected: 201, body: { ...eventBody, name: `${eventBody.name} B`, clientId: clientB.id } });
  await call(apiUrl, `/v1/events/${otherEvent.id}`, { key: managerToken, expected: 404 });
  await call(apiUrl, `/v1/events/${otherEvent.id}`, { method: 'PATCH', key: managerToken, body: { venue: 'Proibido' }, expected: 404 });
  await call(apiUrl, `/v1/events/${event.id}`, { method: 'PATCH', key: staffToken, body: { venue: 'Proibido' }, expected: 403 });
  const updatedEvent = await call(apiUrl, `/v1/events/${event.id}`, { method: 'PATCH', key: managerToken, body: { venue: 'Teste atualizado' } });
  if (updatedEvent.venue !== 'Teste atualizado') throw new Error('Atualização do evento não persistiu');
  const guest = await call(apiUrl, `/v1/events/${event.id}/guests`, { method: 'POST', key: managerToken, expected: 201, body: { name: 'Convidado E2E RBAC', email: `convidado-${suffix}@example.invalid` } });
  await call(apiUrl, `/v1/events/${event.id}/guests/${guest.id}`, { method: 'PATCH', key: staffToken, body: { name: 'Proibido' }, expected: 403 });
  const updatedGuest = await call(apiUrl, `/v1/events/${event.id}/guests/${guest.id}`, { method: 'PATCH', key: managerToken, body: { name: 'Convidado E2E atualizado' } });
  if (updatedGuest.name !== 'Convidado E2E atualizado') throw new Error('Atualização do convidado não persistiu');
  const inviteToken = new URL(guest.invitationUrl).pathname.split('/').at(-1);
  await call(apiUrl, `/v1/invitations/${inviteToken}/accept`, { method: 'POST', body: { consent: true, imageBase64 } });
  const matched = await call(apiUrl, `/v1/events/${event.id}/face-lookup`, { method: 'POST', key: managerToken, raw: image, contentType: 'image/png' });
  if (!matched.matched || matched.guestId !== guest.id) throw new Error('Foto não identificou convidado elegível');
  const unknown = await call(apiUrl, `/v1/events/${event.id}/face-lookup`, { method: 'POST', key: managerToken, raw: unknownImage, contentType: 'image/png' });
  if (unknown.matched || unknown.reason !== 'no_match') throw new Error('Foto desconhecida foi aceita');
  await call(apiUrl, `/v1/events/${event.id}/face-lookup`, { method: 'POST', key: staffToken, raw: image, contentType: 'image/png', expected: 403 });

  console.log(JSON.stringify({ result: 'passed', firstAdmin: 'login_and_first_password_change_required', clientA: clientA.id, clientB: clientB.id, eventId: event.id, roleChecks: 'passed', faceLookup: 'matched_and_no_match' }));
} finally {
  for (const userId of testUsers) {
    try { await call(apiUrl, `/v1/users/${userId}`, { method: 'PATCH', key: adminKey, body: { active: false } }); } catch { /* relatório principal preserva falha anterior */ }
  }
  apiProcess?.kill();
  realApiProcess?.kill();
  faceServer.close();
}
