import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { acceptInvitationSchema, eventIdSchema, inviteTokenSchema, scanSchema } from '@biofacial/contracts';
import { actorFor, canReadClient, canWriteClient, matchesKey } from './security.js';

type Config = { scannerKey?: string; faceEngineUrl?: string; faceEngineToken?: string };
const enrollResponse = z.object({ profileId: z.uuid(), result: z.enum(['enrolled', 'matched']) });
const identifyResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('match'), profileId: z.uuid(), confidence: z.number().min(0).max(1) }),
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
  if (response.status === 422 || response.status === 413 || response.status === 409) {
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
      `UPDATE events SET status = 'active' WHERE id = $1 AND status IN ('draft', 'published') AND ends_at > now()
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
      `SELECT g.id, g.event_id, g.invitation_status, e.status AS event_status,
              g.person_face_id, g.email, g.phone_e164
       FROM guests g JOIN events e ON e.id = g.event_id
       WHERE g.deleted_at IS NULL AND (g.invitation_token_hash = $1 OR EXISTS (SELECT 1 FROM invitation_tokens t WHERE t.guest_id = g.id AND t.token_hash = $1))`, [hash],
    );
    if (!guestResult.rowCount) return reply.code(404).send({ error: 'invitation_not_found' });
    const guest = guestResult.rows[0];
    if (guest.event_status === 'finished' || guest.event_status === 'cancelled') {
      return reply.code(409).send({ error: 'invitation_unavailable' });
    }
    const known = await db.query(
      `SELECT DISTINCT profile_id FROM person_face_contacts
       WHERE (kind = 'email' AND value = lower($1))
          OR (kind = 'phone' AND value = $2)`,
      [guest.email, guest.phone_e164],
    );
    const knownIds = new Set<string>(known.rows.map(row => row.profile_id));
    if (guest.person_face_id) knownIds.add(guest.person_face_id);
    if (knownIds.size > 1) return reply.code(409).send({ error: 'identity_conflict' });
    if (knownIds.size === 1) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM events WHERE id = $1 FOR SHARE', [guest.event_id]);
        await client.query("SELECT pg_advisory_xact_lock(hashtext('biofacial_face_enrollment'))");
        const current = await client.query(
          `SELECT g.id, g.event_id, g.invitation_status, g.email, g.phone_e164,
                  g.person_face_id, g.confirmed_revision, e.status AS event_status, e.revision AS event_revision
             FROM guests g JOIN events e ON e.id = g.event_id
            WHERE g.id = $1 AND g.deleted_at IS NULL
              AND (g.invitation_token_hash = $2 OR EXISTS (
                SELECT 1 FROM invitation_tokens t WHERE t.guest_id = g.id AND t.token_hash = $2
              )) FOR UPDATE OF g`,
          [guest.id, hash],
        );
        if (!current.rowCount || !['registered', 'invited', 'accepted', 'reconfirmation_pending', 'declined'].includes(current.rows[0].invitation_status)
          || ['finished', 'cancelled'].includes(current.rows[0].event_status)) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'invitation_unavailable' });
        }
        if (current.rows[0].invitation_status === 'accepted'
          && current.rows[0].confirmed_revision === current.rows[0].event_revision
          && current.rows[0].person_face_id) {
          await client.query('ROLLBACK');
          return { status: 'accepted', guestId: guest.id };
        }
        const contactProfiles = await client.query(
          `SELECT DISTINCT profile_id FROM person_face_contacts
           WHERE (kind = 'email' AND value = lower($1))
              OR (kind = 'phone' AND value = $2)`,
          [current.rows[0].email, current.rows[0].phone_e164],
        );
        const ids = new Set<string>(contactProfiles.rows.map(row => row.profile_id));
        if (current.rows[0].person_face_id) {
          ids.add(current.rows[0].person_face_id);
        }
        if (ids.size !== 1) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: ids.size ? 'identity_conflict' : 'face_capture_required' });
        }
        const profileId = [...ids][0];
        const duplicate = await client.query(
          `SELECT 1 FROM guests WHERE event_id = $1 AND id <> $2
             AND person_face_id = $3 AND deleted_at IS NULL
             AND invitation_status IN ('accepted', 'attended') LIMIT 1`,
          [current.rows[0].event_id, guest.id, profileId],
        );
        if (duplicate.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'face_already_registered_for_event' });
        }
        for (const [kind, value] of [
          ['email', current.rows[0].email?.toLowerCase()],
          ['phone', current.rows[0].phone_e164],
        ] as const) {
          if (value) {
            await client.query(
              `INSERT INTO person_face_contacts (kind, value, profile_id)
               VALUES ($1, $2, $3) ON CONFLICT (kind, value) DO NOTHING`,
              [kind, value, profileId],
            );
          }
        }
        await client.query(
          `UPDATE guests SET person_face_id = $2, invitation_status = 'accepted',
                  accepted_at = COALESCE(accepted_at, now()), confirmed_revision = $3 WHERE id = $1`,
          [guest.id, profileId, current.rows[0].event_revision],
        );
        await client.query(
          `INSERT INTO guest_responses (event_id, guest_id, event_revision, response)
           VALUES ($1, $2, $3, 'accepted')`,
          [current.rows[0].event_id, guest.id, current.rows[0].event_revision],
        );
        await client.query(
          `INSERT INTO audit_events (event_id, guest_id, action) VALUES ($1, $2, 'invitation_accepted')`,
          [current.rows[0].event_id, guest.id],
        );
        await client.query('COMMIT');
        return { status: 'accepted', guestId: guest.id };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    if (!body.data.imageBase64) return reply.code(422).send({ error: 'face_capture_required' });
    let profileId: string;
    try {
      const response = await callFaceEngine('/v1/verify-or-enroll', {
        guestId: guest.id, eventId: guest.event_id, imageBase64: body.data.imageBase64,
      }, config);
      profileId = enrollResponse.parse(response).profileId;
    } catch (error) {
      if (error instanceof FaceImageError) return reply.code(error.status).send({ error: error.message });
      app.log.error({ err: error }, 'Face verification failed');
      return reply.code(503).send({ error: 'face_engine_unavailable' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const currentEvent = await client.query('SELECT revision, status FROM events WHERE id = $1 FOR SHARE', [guest.event_id]);
      if (!currentEvent.rowCount || ['finished', 'cancelled'].includes(currentEvent.rows[0].status)) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'invitation_unavailable' });
      }
      const updated = await client.query(
        `UPDATE guests SET person_face_id = $2,
                            invitation_status = 'accepted', accepted_at = COALESCE(accepted_at, now()), confirmed_revision = $3
         WHERE id = $1 AND deleted_at IS NULL AND invitation_status IN ('registered', 'invited', 'accepted', 'reconfirmation_pending', 'declined') RETURNING id, event_id, invitation_status`,
        [guest.id, profileId, currentEvent.rows[0].revision],
      );
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ error: 'invitation_unavailable' });
      }
      await client.query(
        `INSERT INTO guest_responses (event_id, guest_id, event_revision, response)
         VALUES ($1, $2, $3, 'accepted')`,
        [guest.event_id, guest.id, currentEvent.rows[0].revision],
      );
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

  app.post('/v1/invitations/:token/decline', async (request, reply) => {
    const token = inviteTokenSchema.safeParse((request.params as { token?: string }).token);
    if (!token.success) return reply.code(404).send({ error: 'invitation_not_found' });
    const hash = createHash('sha256').update(token.data).digest('hex');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const lookup = await client.query(
        `SELECT g.id, g.event_id FROM guests g WHERE g.deleted_at IS NULL
         AND (g.invitation_token_hash = $1 OR EXISTS
           (SELECT 1 FROM invitation_tokens t WHERE t.guest_id = g.id AND t.token_hash = $1))`, [hash],
      );
      if (!lookup.rowCount) {
        await client.query('ROLLBACK'); return reply.code(404).send({ error: 'invitation_not_found' });
      }
      const event = await client.query('SELECT revision, status FROM events WHERE id = $1 FOR SHARE', [lookup.rows[0].event_id]);
      const guest = await client.query('SELECT invitation_status FROM guests WHERE id = $1 FOR UPDATE', [lookup.rows[0].id]);
      if (!event.rowCount || ['finished', 'cancelled'].includes(event.rows[0].status)
        || !guest.rowCount || guest.rows[0].invitation_status === 'attended') {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'invitation_unavailable' });
      }
      if (guest.rows[0].invitation_status === 'declined') {
        await client.query('ROLLBACK'); return { status: 'declined', guestId: lookup.rows[0].id };
      }
      await client.query(
        `UPDATE guests SET invitation_status = 'declined', confirmed_revision = NULL WHERE id = $1`,
        [lookup.rows[0].id],
      );
      await client.query(
        `INSERT INTO guest_responses (event_id, guest_id, event_revision, response)
         VALUES ($1, $2, $3, 'declined')`,
        [lookup.rows[0].event_id, lookup.rows[0].id, event.rows[0].revision],
      );
      await client.query(
        `INSERT INTO audit_events (event_id, guest_id, action) VALUES ($1, $2, 'invitation_declined')`,
        [lookup.rows[0].event_id, lookup.rows[0].id],
      );
      await client.query('COMMIT');
      return { status: 'declined', guestId: lookup.rows[0].id };
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
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
    if (now >= new Date(event.rows[0].ends_at).getTime()) {
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
      const currentEvent = await client.query(
        'SELECT revision, status, starts_at, ends_at FROM events WHERE id = $1 FOR SHARE', [eventId.data],
      );
      const currentTime = Date.now();
      if (!currentEvent.rowCount || currentEvent.rows[0].status !== 'active'
        || currentTime < new Date(currentEvent.rows[0].starts_at).getTime()
        || currentTime >= new Date(currentEvent.rows[0].ends_at).getTime()) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_not_active' });
      }
      if (identification.status !== 'match') {
        const reason = identification.status;
        await client.query(`INSERT INTO access_events (event_id, action, reason) VALUES ($1, 'denied', $2)`, [eventId.data, reason]);
        await client.query('COMMIT');
        return { action: 'denied', reason };
      }
      const guest = await client.query(
        `SELECT id, name, invitation_status, person_face_id, confirmed_revision FROM guests
         WHERE person_face_id = $1 AND event_id = $2 AND deleted_at IS NULL
         ORDER BY CASE WHEN invitation_status IN ('accepted', 'attended') THEN 0 ELSE 1 END, created_at
         LIMIT 1 FOR UPDATE`, [identification.profileId, eventId.data],
      );
      if (!guest.rowCount) {
        const pending = await client.query(
          `SELECT g.id, g.name FROM guests g
           JOIN person_face_contacts c ON c.profile_id = $1
            AND ((c.kind = 'email' AND c.value = lower(g.email))
              OR (c.kind = 'phone' AND c.value = g.phone_e164))
           WHERE g.event_id = $2 AND g.deleted_at IS NULL
           ORDER BY g.created_at LIMIT 1`, [identification.profileId, eventId.data],
        );
        if (pending.rowCount) {
          await client.query(
            `INSERT INTO access_events (event_id, guest_id, action, reason, confidence) VALUES ($1, $2, 'denied', 'invitation_not_accepted', $3)`,
            [eventId.data, pending.rows[0].id, identification.confidence],
          );
          await client.query('COMMIT');
          return { action: 'denied', reason: 'invitation_not_accepted', guestName: pending.rows[0].name };
        }
        const knownPerson = await client.query(
          `SELECT name FROM guests WHERE person_face_id = $1 AND deleted_at IS NULL
           ORDER BY created_at LIMIT 1`, [identification.profileId],
        );
        await client.query(
          `INSERT INTO access_events (event_id, action, reason, confidence) VALUES ($1, 'denied', 'not_invited', $2)`,
          [eventId.data, identification.confidence],
        );
        await client.query('COMMIT');
        return { action: 'denied', reason: 'not_invited', guestName: knownPerson.rows[0]?.name };
      }
      if (!['accepted', 'attended'].includes(guest.rows[0].invitation_status)
        || guest.rows[0].confirmed_revision !== currentEvent.rows[0].revision) {
        const reason = guest.rows[0].invitation_status === 'reconfirmation_pending'
          || guest.rows[0].confirmed_revision !== currentEvent.rows[0].revision
          ? 'reconfirmation_required' : 'invitation_not_accepted';
        await client.query(
          `INSERT INTO access_events (event_id, guest_id, action, reason, confidence) VALUES ($1, $2, 'denied', $3, $4)`,
          [eventId.data, guest.rows[0].id, reason, identification.confidence],
        );
        await client.query('COMMIT');
        return { action: 'denied', reason, guestName: guest.rows[0].name };
      }
      const guestId = guest.rows[0].id;
      const last = await client.query(
        `SELECT action FROM access_events WHERE event_id = $1 AND guest_id = $2 AND action IN ('entry', 'exit')
         ORDER BY created_at DESC, id DESC LIMIT 1`, [eventId.data, guestId],
      );
      const current = last.rows[0]?.action === 'entry' ? 'inside' : 'outside';
      if (body.data.direction === 'entry' && current === 'inside' || body.data.direction === 'exit' && current === 'outside') {
        const reason = current === 'inside' ? 'already_inside' : 'not_inside';
        await client.query(`INSERT INTO access_events (event_id, guest_id, action, reason, confidence) VALUES ($1, $2, 'denied', $3, $4)`, [eventId.data, guestId, reason, identification.confidence]);
        await client.query('COMMIT');
        return { action: 'denied', reason, guestId, guestName: guest.rows[0].name };
      }
      const action = body.data.direction ?? (current === 'inside' ? 'exit' : 'entry');
      const inserted = await client.query(
        `INSERT INTO access_events (event_id, guest_id, action, confidence) VALUES ($1, $2, $3, $4)
         RETURNING id, created_at AS "createdAt"`,
        [eventId.data, guestId, action, identification.confidence],
      );
      if (action === 'entry') await client.query("UPDATE guests SET invitation_status = 'attended' WHERE id = $1 AND invitation_status = 'accepted'", [guestId]);
      await client.query('COMMIT');
      return { action, guestId, guestName: guest.rows[0].name, ...inserted.rows[0] };
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
      `SELECT g.id, g.name FROM guests g JOIN events e ON e.id = g.event_id
       WHERE g.person_face_id = $1 AND g.event_id = $2 AND g.deleted_at IS NULL
       AND g.invitation_status IN ('accepted', 'attended') AND g.confirmed_revision = e.revision
       ORDER BY g.created_at LIMIT 1`,
      [identification.profileId, eventId.data],
    );
    if (!guest.rowCount) {
      const pending = await db.query(
        `SELECT g.name FROM guests g JOIN person_face_contacts c ON c.profile_id = $1
          AND ((c.kind = 'email' AND c.value = lower(g.email))
            OR (c.kind = 'phone' AND c.value = g.phone_e164))
         WHERE g.event_id = $2 AND g.deleted_at IS NULL ORDER BY g.created_at LIMIT 1`,
        [identification.profileId, eventId.data],
      );
      if (pending.rowCount) return { matched: false, reason: 'invitation_not_accepted', guestName: pending.rows[0].name };
      const knownPerson = await db.query(
        `SELECT name FROM guests WHERE person_face_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
        [identification.profileId],
      );
      return { matched: false, reason: 'not_invited', guestName: knownPerson.rows[0]?.name };
    }
    return { matched: true, guestId: guest.rows[0].id, guestName: guest.rows[0].name, confidence: identification.confidence };
  });
}
