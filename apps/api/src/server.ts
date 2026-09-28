import { createHash, randomBytes } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import pg from 'pg';
import { createEventSchema, createGuestSchema, eventIdSchema, inviteTokenSchema } from '@biofacial/contracts';
import { registerFlows } from './flows.js';
import { registerAuth } from './auth.js';
import { registerManagement } from './management.js';
import { actorFor, canWriteClient } from './security.js';
import { z } from 'zod';

const databaseUrl = process.env.DATABASE_URL;
const adminApiKey = process.env.ADMIN_API_KEY;
const publicBaseUrl = process.env.PUBLIC_BASE_URL;
const scannerApiKey = process.env.SCANNER_API_KEY;
const faceEngineUrl = process.env.FACE_ENGINE_URL;
const faceEngineToken = process.env.FACE_ENGINE_TOKEN;
if (!databaseUrl) {
  throw new Error('DATABASE_URL é obrigatória');
}
if (process.env.BROWSER_DEMO === 'true' && (!adminApiKey || adminApiKey.length < 32)) {
  throw new Error('ADMIN_API_KEY é obrigatória no modo de demonstração');
}
if (scannerApiKey && scannerApiKey.length < 32) {
  throw new Error('SCANNER_API_KEY deve ter pelo menos 32 caracteres');
}
if ((faceEngineUrl && !faceEngineToken) || (!faceEngineUrl && faceEngineToken) || (faceEngineToken && faceEngineToken.length < 32)) {
  throw new Error('FACE_ENGINE_URL e FACE_ENGINE_TOKEN devem ser configurados juntos; token com pelo menos 32 caracteres');
}

const db = new pg.Pool({ connectionString: databaseUrl, max: 10 });
// O token do convite faz parte da URL; logs automáticos de requisição o exporiam.
const app = Fastify({ logger: true, logController: new LogController({ disableRequestLogging: true }), bodyLimit: 3 * 1024 * 1024 });
app.addContentTypeParser(['image/jpeg', 'image/png'], { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
const updateEventSchema = z.object({
  clientId: z.uuid().optional(), externalId: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(3).max(160).optional(), startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(), timezone: z.string().trim().min(1).max(80).optional(),
  venue: z.string().trim().min(1).max(240).optional(),
}).refine(value => Object.keys(value).length > 0);
const updateGuestSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.email().nullable().optional(),
  phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
}).refine(value => Object.keys(value).length > 0);

app.get('/health', async () => {
  await db.query('SELECT 1');
  return { status: 'ok' };
});

app.post('/v1/events', async (request, reply) => {
  const actor = await actorFor(request, db);
  if (!actor) return reply.code(401).send({ error: 'unauthorized' });
  if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
  if (actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
  const parsed = createEventSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
  const { clientId, externalId, name, startsAt, endsAt, timezone, venue } = parsed.data;
  if (!clientId && process.env.BROWSER_DEMO !== 'true') return reply.code(400).send({ error: 'client_id_required' });
  if (!canWriteClient(actor, clientId ?? null)) return reply.code(403).send({ error: 'forbidden_client' });
  if (clientId) {
    const client = await db.query(`SELECT active FROM clients WHERE id = $1`, [clientId]);
    if (!client.rowCount || !client.rows[0].active) return reply.code(400).send({ error: 'invalid_client_id' });
  }
  try {
    const result = await db.query(
      `INSERT INTO events (client_id, external_id, name, starts_at, ends_at, timezone, venue)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, client_id AS "clientId", name, starts_at AS "startsAt", ends_at AS "endsAt", timezone, venue, status`,
      [clientId ?? null, externalId ?? null, name, startsAt, endsAt, timezone, venue],
    );
    return reply.code(201).send(result.rows[0]);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'event_external_id_exists' });
    throw error;
  }
});

app.patch('/v1/events/:eventId', async (request, reply) => {
  const actor = await actorFor(request, db);
  if (!actor) return reply.code(401).send({ error: 'unauthorized' });
  if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
  if (actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
  const id = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
  const parsed = updateEventSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input' });
  const current = await db.query(`SELECT client_id FROM events WHERE id = $1`, [id.data]);
  if (!current.rowCount || !canWriteClient(actor, current.rows[0].client_id)) return reply.code(404).send({ error: 'event_not_found' });
  if (parsed.data.clientId && parsed.data.clientId !== current.rows[0].client_id) {
    if (actor.role !== 'adm') return reply.code(403).send({ error: 'client_transfer_forbidden' });
    const target = await db.query(`SELECT active FROM clients WHERE id = $1`, [parsed.data.clientId]);
    if (!target.rowCount || !target.rows[0].active) return reply.code(400).send({ error: 'invalid_client_id' });
  }
  const value = parsed.data;
  try {
    const result = await db.query(
      `UPDATE events SET client_id = COALESCE($2, client_id), external_id = COALESCE($3, external_id),
         name = COALESCE($4, name), starts_at = COALESCE($5, starts_at), ends_at = COALESCE($6, ends_at),
         timezone = COALESCE($7, timezone), venue = COALESCE($8, venue)
       WHERE id = $1 RETURNING id, client_id AS "clientId", name, status, starts_at AS "startsAt", ends_at AS "endsAt", timezone, venue`,
      [id.data, value.clientId ?? null, value.externalId ?? null, value.name ?? null, value.startsAt ?? null, value.endsAt ?? null, value.timezone ?? null, value.venue ?? null],
    );
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23514') return reply.code(400).send({ error: 'invalid_event_period' });
    if (error instanceof Error && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'event_external_id_exists' });
    throw error;
  }
});

app.post('/v1/events/:eventId/guests', async (request, reply) => {
  const actor = await actorFor(request, db);
  if (!actor) return reply.code(401).send({ error: 'unauthorized' });
  if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
  if (actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
  if (!publicBaseUrl) return reply.code(503).send({ error: 'invitation_app_unavailable' });
  const eventId = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
  const guest = createGuestSchema.safeParse(request.body);
  if (!eventId.success || !guest.success) return reply.code(400).send({ error: 'invalid_input' });
  const event = await db.query(`SELECT client_id FROM events WHERE id = $1`, [eventId.data]);
  if (!event.rowCount) return reply.code(404).send({ error: 'event_not_found' });
  if (!canWriteClient(actor, event.rows[0].client_id)) return reply.code(403).send({ error: 'forbidden_client' });
  const token = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(token).digest('hex');
  try {
    const result = await db.query(
      `INSERT INTO guests (event_id, name, email, phone_e164, invitation_token_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone_e164 AS "phoneE164", invitation_status AS "invitationStatus"`,
      [eventId.data, guest.data.name, guest.data.email ?? null, guest.data.phoneE164 ?? null, hash],
    );
    const invitationUrl = new URL(`/convite/${token}`, publicBaseUrl).toString();
    return reply.code(201).send({ ...result.rows[0], invitationUrl });
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === '23503') return reply.code(404).send({ error: 'event_not_found' });
      if (error.code === '23505') return reply.code(409).send({ error: 'guest_already_exists' });
    }
    throw error;
  }
});

app.patch('/v1/events/:eventId/guests/:guestId', async (request, reply) => {
  const actor = await actorFor(request, db);
  if (!actor) return reply.code(401).send({ error: 'unauthorized' });
  if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
  if (actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
  const params = request.params as { eventId?: string; guestId?: string };
  const eventId = eventIdSchema.safeParse(params.eventId);
  const guestId = eventIdSchema.safeParse(params.guestId);
  const parsed = updateGuestSchema.safeParse(request.body);
  if (!eventId.success || !guestId.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input' });
  const event = await db.query(`SELECT client_id FROM events WHERE id = $1`, [eventId.data]);
  if (!event.rowCount || !canWriteClient(actor, event.rows[0].client_id)) return reply.code(404).send({ error: 'event_not_found' });
  const value = parsed.data;
  try {
    const result = await db.query(
      `UPDATE guests SET name = COALESCE($3, name),
         email = CASE WHEN $4::boolean THEN $5 ELSE email END,
         phone_e164 = CASE WHEN $6::boolean THEN $7 ELSE phone_e164 END
       WHERE id = $1 AND event_id = $2
       RETURNING id, name, email, phone_e164 AS "phoneE164", invitation_status AS "invitationStatus"`,
      [guestId.data, eventId.data, value.name ?? null, Object.hasOwn(value, 'email'), value.email ?? null, Object.hasOwn(value, 'phoneE164'), value.phoneE164 ?? null],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'guest_not_found' });
    return result.rows[0];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === '23514') return reply.code(400).send({ error: 'contact_required' });
    if (error instanceof Error && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'guest_already_exists' });
    throw error;
  }
});

app.get('/v1/invitations/:token', async (request, reply) => {
  const token = inviteTokenSchema.safeParse((request.params as { token?: string }).token);
  if (!token.success) return reply.code(404).send({ error: 'invitation_not_found' });
  const hash = createHash('sha256').update(token.data).digest('hex');
  const result = await db.query(
    `SELECT g.name AS "guestName", g.invitation_status AS "invitationStatus",
            e.name AS "eventName", e.starts_at AS "startsAt", e.ends_at AS "endsAt",
            e.timezone, e.venue
       FROM guests g JOIN events e ON e.id = g.event_id
      WHERE g.invitation_token_hash = $1`,
    [hash],
  );
  if (!result.rowCount) return reply.code(404).send({ error: 'invitation_not_found' });
  reply.header('Cache-Control', 'no-store');
  return result.rows[0];
});

registerAuth(app, db);
registerManagement(app, db);
registerFlows(app, db, { scannerKey: scannerApiKey, faceEngineUrl, faceEngineToken });

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
  reply.code(status).send({ error: status < 500 ? 'invalid_request' : 'internal_error' });
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: process.env.BROWSER_DEMO === 'true' ? '127.0.0.1' : '0.0.0.0', port });
