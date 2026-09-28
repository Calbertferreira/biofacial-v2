import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

for (const name of ['DATABASE_URL', 'ADMIN_API_KEY', 'SCANNER_API_KEY', 'FACE_ENGINE_TOKEN']) {
  if (!process.env[name]) throw new Error(`${name} não configurada no .env`);
}

const known = Buffer.from('fixture-face-convidado-e2e').toString('base64');
let enrolledGuestId;
let enrolledEventId;
const faceServer = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.FACE_ENGINE_TOKEN}`) return response.writeHead(401).end();
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  response.setHeader('content-type', 'application/json');
  if (request.url === '/v1/enroll' && body.imageBase64 === known) {
    enrolledGuestId = body.guestId;
    enrolledEventId = body.eventId;
    response.end(JSON.stringify({ profileId: `browser-demo-${enrolledGuestId}` }));
  } else if (request.url === '/v1/identify') {
    response.end(JSON.stringify(body.imageBase64 === known && body.eventId === enrolledEventId && enrolledGuestId
      ? { status: 'match', guestId: enrolledGuestId, confidence: 0.99 }
      : { status: 'no_match' }));
  } else {
    response.writeHead(422).end(JSON.stringify({ error: 'invalid_capture' }));
  }
});
faceServer.listen(8101, '127.0.0.1');
await new Promise((resolveReady, reject) => { faceServer.once('listening', resolveReady); faceServer.once('error', reject); });

const shared = {
  ...process.env,
  BROWSER_DEMO: 'true',
  API_INTERNAL_URL: 'http://127.0.0.1:3001',
  FACE_ENGINE_URL: 'http://127.0.0.1:8101',
};
const children = [];

function shutdown() {
  for (const child of children) child.kill();
  faceServer.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

for (const [label, url, name, port] of [
  ['API', 'http://127.0.0.1:3001/health', 'api', 3001],
  ['Manager (demonstração)', 'http://127.0.0.1:3000/demo', 'manager', 3000],
  ['Convite', 'http://127.0.0.1:3002', 'invite', 3002],
  ['Scanner', 'http://127.0.0.1:3003', 'scanner', 3003],
]) {
  const child = name === 'api'
    ? spawn(process.execPath, [resolve('apps/api/dist/server.js')], { env: shared, stdio: 'ignore' })
    : spawn(process.execPath,
      [resolve(`apps/${name}/node_modules/next/dist/bin/next`), 'dev', '-p', String(port), '-H', '127.0.0.1'],
      { cwd: resolve(`apps/${name}`), env: name === 'manager' ? { ...shared, MANAGER_DIST_DIR: '.next-demo' } : shared, stdio: 'ignore' });
  children.push(child);
  let ready = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch { /* aguarda */ }
    if (child.exitCode !== null) break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  if (!ready) { shutdown(); throw new Error(`${label} não iniciou (exitCode=${child.exitCode})`); }
  console.log(`${label}: ${url}`);
}
console.log('Demonstração pronta. Pressione Ctrl+C para encerrar.');
await new Promise(() => {});
