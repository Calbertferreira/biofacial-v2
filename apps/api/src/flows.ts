import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { acceptInvitationSchema, eventIdSchema, inviteTokenSchema, scanSchema } from '@biofacial/contracts';
import { actorFor, canReadClient, canWriteClient, matchesKey } from './security.js';

type Config = { scannerKey?: string; faceEngineUrl?: string; faceEngineToken?: string };
const enrollResponse = z.object({ profileId: z.string().min(1).max(128) });
const identifyResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('match'), guestId: z.uuid(), confidence: z.number().min(0).max(1) }),
  z.object({ status: z.literal('no_match') }),
  z.object({ status: z.literal('review') }),
]);

async function callFaceEngine(path: string, payload: unknown, config: Config): Promise<unknown> {
  if (!config.faceEngineUrl || !config.faceEngineToken) throw new Error('Face engine not configured');
  const response = await fetch(new URL(path, config.faceEngineUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.faceEngineToken}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 422 || response.status === 413) {
    const problem = await response.json() as { detail?: string };
    throw new FaceImageError(problem.detail ?? 'invalid_image', response.status);
  }
  if (!response.ok) throw new Error(`Face engine failed: ${response.status}`);
  return response.json();
}

class FaceImageError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function registerFlows(app: FastifyInstance, db: pg.Pool, config: Config): void {
  app.post('/v1/events/:eventId/finish', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword || actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const eventId = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    if (!eventId.success) return reply.code(400).send({ error: 'invalid_event_id' });
    const event = await db.query(`SELECT client_id FROM events WHERE id = $1`, [eventId.data]);
    if (!event.rowCount || !canWriteClient(actor, event.rows[0].client_id)) return reply.code(404).send({ error: 'event_not_found' });
    const result = await db.query(`UPDATE events SET status = 'finished' WHERE id = $1 AND status = 'active' RETURNING id, status`, [eventId.data]);
    if (!result.rowCount) return reply.code(409).send({ error: 'event_not_active' });
    return result.rows[0];
  });

  app.post('/v1/events/:eventId/activate', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    if (actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const eventId = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    if (!eventId.success) return reply.code(400).send({ error: 'invalid_event_id' });
    const event = await db.query(`SELECT client_id FROM events WHERE id = $1`, [eventId.data]);
    if (!event.rowCount) return reply.code(404).send({ error: 'event_not_found' });
    if (!canWriteClient(actor, event.rows[0].client_id)) return reply.code(403).send({ error: 'forbidden_client' });
    const result = await db.query(
      `UPDATE events SET status = 'active' WHERE id = $1 AND status IN ('draft', 'published')
       RETURNING id, status`, [eventId.data],
    );
    if (!result.rowCount) return reply.code(409).send({ error: 'event_not_activatable' });
    return result.rows[0];
  });

  app.post('/v1/invitations/:token/accept', async (request, reply) => {
    const token = inviteTokenSchema.safeParse((request.params as { token?: string }).token);
    const body = acceptInvitationSchema.safeParse(request.body);
    if (!token.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    const hash = createHash('sha256').update(token.data).digest('hex');
    const guestResult = await db.query(
      `SELECT g.id, g.event_id, g.face_profile_id, g.invitation_status, g.email, g.phone_e164,
              e.client_id, e.status AS event_status
       FROM guests g JOIN events e ON e.id = g.event_id
       WHERE g.invitation_token_hash = $1 OR EXISTS (SELECT 1 FROM invitation_tokens t WHERE t.guest_id = g.id AND t.token_hash = $1)`, [hash],
    );
    if (!guestResult.rowCount) return reply.code(404).send({ error: 'invitation_not_found' });
    const guest = guestResult.rows[0];
    if (guest.event_status === 'finished' || guest.event_status === 'cancelled' || guest.invitation_status === 'declined') {
      return reply.code(409).send({ error: 'invitation_unavailable' });
    }
    let profileId: string | null = guest.face_profile_id;
    if (!profileId) {
      const previous = await db.query(
        `SELECT prior.face_profile_id FROM guests prior JOIN events pe ON pe.id = prior.event_id
         WHERE prior.id <> $1 AND pe.client_id = $2 AND prior.face_profile_id IS NOT NULL
           AND prior.invitation_status IN ('accepted', 'attended')
           AND (($3::text IS NOT NULL AND lower(prior.email) = lower($3::text))
             OR ($3::text IS NULL AND $4::text IS NOT NULL AND prior.phone_e164 = $4::text))
         ORDER BY prior.accepted_at DESC LIMIT 1`,
        [guest.id, guest.client_id, guest.email, guest.phone_e164],
      );
      profileId = previous.rows[0]?.face_profile_id ?? null;
    }
    if (!profileId) {
      if (!body.data.imageBase64) return reply.code(422).send({ error: 'face_capture_required' });
      try {
        const response = await callFaceEngine('/v1/enroll', {
          guestId: guest.id, eventId: guest.event_id, imageBase64: body.data.imageBase64,
        }, config);
        profileId = enrollResponse.parse(response).profileId;
      } catch (error) {
        if (error instanceof FaceImageError) return reply.code(error.status).send({ error: error.message });
        app.log.error({ err: error }, 'Face enrollment failed');
        return reply.code(503).send({ error: 'face_engine_unavailable' });
      }
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE guests SET face_profile_id = COALESCE(face_profile_id, $2),
                            invitation_status = 'accepted', accepted_at = COALESCE(accepted_at, now())
         WHERE id = $1 AND invitation_status IN ('registered', 'invited', 'accepted') RETURNING id, event_id, invitation_status`,
        [guest.id, profileId],
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'invitation_unavailable' });
      }
      await client.query(
        `INSERT INTO audit_events (event_id, guest_id, action) VALUES ($1, $2, 'invitation_accepted')`,
        [guest.event_id, guest.id],
      );
      await client.query('COMMIT');
      return { status: 'accepted', guestId: guest.id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/v1/events/:eventId/scan', async (request, reply) => {
    const keyAuthorized = !!config.scannerKey && matchesKey(request.headers.authorization, config.scannerKey);
    const actor = keyAuthorized ? null : await actorFor(request, db);
    if (!keyAuthorized && !actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor?.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    const eventId = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    const body = scanSchema.safeParse(request.body);
    if (!eventId.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
    const event = await db.query(`SELECT client_id, status, starts_at, ends_at, timezone FROM events WHERE id = $1`, [eventId.data]);
    if (!event.rowCount) return reply.code(404).send({ error: 'event_not_found' });
    if (actor && !canReadClient(actor, event.rows[0].client_id)) return reply.code(403).send({ error: 'forbidden_client' });
    const now = Date.now();
    if (event.rows[0].status !== 'active') {
      return reply.code(409).send({ error: 'event_not_active' });
    }
    if (now < new Date(event.rows[0].starts_at).getTime()) {
      return reply.code(409).send({ error: 'event_not_started', startsAt: event.rows[0].starts_at, timezone: event.rows[0].timezone });
    }
    if (now > new Date(event.rows[0].ends_at).getTime()) {
      return reply.code(409).send({ error: 'event_ended' });
    }
    let identification: z.infer<typeof identifyResponse>;
    try {
      identification = identifyResponse.parse(await callFaceEngine('/v1/identify', {
        eventId: eventId.data, imageBase64: body.data.imageBase64,
      }, config));
    } catch (error) {
      if (error instanceof FaceImageError) {
        await db.query(`INSERT INTO access_events (event_id, action, reason) VALUES ($1, 'denied', 'invalid_capture')`, [eventId.data]);
        return reply.code(error.status).send({ error: error.message });
      }
      app.log.error({ err: error }, 'Face identification failed');
      return reply.code(503).send({ error: 'face_engine_unavailable' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (identification.status !== 'match') {
        const reason = identification.status;
        await client.query(`INSERT INTO access_events (event_id, action, reason) VALUES ($1, 'denied', $2)`, [eventId.data, reason]);
        await client.query('COMMIT');
        return { action: 'denied', reason };
      }
      const guest = await client.query(
        `SELECT id, name, invitation_status, face_profile_id FROM guests
         WHERE id = $1 AND event_id = $2 FOR UPDATE`, [identification.guestId, eventId.data],
      );
      if (!guest.rowCount || !['accepted', 'attended'].includes(guest.rows[0].invitation_status) || !guest.rows[0].face_profile_id) {
        await client.query(
          `INSERT INTO access_events (event_id, action, reason, confidence) VALUES ($1, 'denied', 'guest_not_eligible', $2)`,
          [eventId.data, identification.confidence],
        );
        await client.query('COMMIT');
        return { action: 'denied', reason: 'guest_not_eligible' };
      }
      const last = await client.query(
        `SELECT action FROM access_events WHERE event_id = $1 AND guest_id = $2 AND action IN ('entry', 'exit')
         ORDER BY created_at DESC, id DESC LIMIT 1`, [eventId.data, identification.guestId],
      );
      const current = last.rows[0]?.action === 'entry' ? 'inside' : 'outside';
      if (body.data.direction === 'entry' && current === 'inside' || body.data.direction === 'exit' && current === 'outside') {
        const reason = current === 'inside' ? 'already_inside' : 'not_inside';
        await client.query(`INSERT INTO access_events (event_id, guest_id, action, reason, confidence) VALUES ($1, $2, 'denied', $3, $4)`, [eventId.data, identification.guestId, reason, identification.confidence]);
        await client.query('COMMIT');
        return { action: 'denied', reason, guestId: identification.guestId, guestName: guest.rows[0].name };
      }
      const action = body.data.direction ?? (current === 'inside' ? 'exit' : 'entry');
      const inserted = await client.query(
        `INSERT INTO access_events (event_id, guest_id, action, confidence) VALUES ($1, $2, $3, $4)
         RETURNING id, created_at AS "createdAt"`,
        [eventId.data, identification.guestId, action, identification.confidence],
      );
      if (action === 'entry') await client.query("UPDATE guests SET invitation_status = 'attended' WHERE id = $1 AND invitation_status = 'accepted'", [identification.guestId]);
      await client.query('COMMIT');
      return { action, guestId: identification.guestId, guestName: guest.rows[0].name, ...inserted.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/v1/events/:eventId/access-events', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    const eventId = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    if (!eventId.success) return reply.code(400).send({ error: 'invalid_event_id' });
    const event = await db.query(`SELECT client_id FROM events WHERE id = $1`, [eventId.data]);
    if (!event.rowCount || !canReadClient(actor, event.rows[0].client_id)) return reply.code(404).send({ error: 'event_not_found' });
    const result = await db.query(
      `SELECT a.id, a.action, a.reason, a.created_at AS "createdAt", g.name AS "guestName"
       FROM access_events a LEFT JOIN guests g ON g.id = a.guest_id
       WHERE a.event_id = $1 ORDER BY a.created_at ASC, a.id ASC LIMIT 500`, [eventId.data],
    );
    return { items: result.rows };
  });

  app.post('/v1/events/:eventId/face-lookup', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    if (actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const eventId = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    if (!eventId.success) return reply.code(400).send({ error: 'invalid_event_id' });
    const event = await db.query(`SELECT client_id FROM events WHERE id = $1`, [eventId.data]);
    if (!event.rowCount || !canWriteClient(actor, event.rows[0].client_id)) return reply.code(404).send({ error: 'event_not_found' });
    const imageBase64 = Buffer.isBuffer(request.body)
      ? request.body.toString('base64')
      : scanSchema.safeParse(request.body).data?.imageBase64;
    if (!imageBase64 || imageBase64.length > 2_000_000) return reply.code(400).send({ error: 'invalid_image' });
    let identification: z.infer<typeof identifyResponse>;
    try {
      identification = identifyResponse.parse(await callFaceEngine('/v1/identify', { eventId: eventId.data, imageBase64 }, config));
    } catch (error) {
      if (error instanceof FaceImageError) return reply.code(error.status).send({ error: error.message });
      app.log.error({ err: error }, 'Face lookup failed');
      return reply.code(503).send({ error: 'face_engine_unavailable' });
    }
    reply.header('Cache-Control', 'no-store');
    if (identification.status !== 'match') return { matched: false, reason: identification.status };
    const guest = await db.query(
      `SELECT id, name FROM guests WHERE id = $1 AND event_id = $2 AND invitation_status IN ('accepted', 'attended') AND face_profile_id IS NOT NULL`,
      [identification.guestId, eventId.data],
    );
    if (!guest.rowCount) return { matched: false, reason: 'not_invited' };
    return { matched: true, guestId: guest.rows[0].id, guestName: guest.rows[0].name, confidence: identification.confidence };
  });
}
