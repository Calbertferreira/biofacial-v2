import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { eventIdSchema } from '@biofacial/contracts';
import { actorFor, canWriteClient } from './security.js';

const updateSchema = z.object({
  clientId: z.uuid().optional(), externalId: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(3).max(160).optional(), startsAt: z.iso.datetime({ offset: true }).optional(),
  endsAt: z.iso.datetime({ offset: true }).optional(), timezone: z.string().trim().min(1).max(80).optional(),
  venue: z.string().trim().min(1).max(240).optional(), reason: z.string().trim().min(10).max(500).optional(),
}).refine(value => Object.keys(value).some(key => key !== 'reason'));
const reasonSchema = z.object({ reason: z.string().trim().min(10).max(500) });

export function registerEventManagement(app: FastifyInstance, db: pg.Pool): void {
  app.patch('/v1/events/:eventId', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword || actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const id = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    const parsed = updateSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.success ? undefined : parsed.error.flatten() });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [id.data]);
      if (!found.rowCount || !canWriteClient(actor, found.rows[0].client_id)) {
        await client.query('ROLLBACK'); return reply.code(404).send({ error: 'event_not_found' });
      }
      const old = found.rows[0];
      if (['finished', 'cancelled'].includes(old.status)) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_immutable' });
      }
      const value = parsed.data;
      const next = {
        clientId: value.clientId ?? old.client_id, externalId: value.externalId ?? old.external_id,
        name: value.name ?? old.name, startsAt: value.startsAt ?? old.starts_at,
        endsAt: value.endsAt ?? old.ends_at, timezone: value.timezone ?? old.timezone,
        venue: value.venue ?? old.venue,
      };
      const oldStart = new Date(old.starts_at).getTime();
      const oldEnd = new Date(old.ends_at).getTime();
      const newStart = new Date(next.startsAt).getTime();
      const newEnd = new Date(next.endsAt).getTime();
      if (newEnd <= newStart) {
        await client.query('ROLLBACK'); return reply.code(400).send({ error: 'invalid_event_period' });
      }
      const counts = await client.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL AND send_attempts > 0)::int AS sent,
                count(*) FILTER (WHERE deleted_at IS NULL AND invitation_status IN ('accepted', 'attended', 'reconfirmation_pending'))::int AS confirmed
         FROM guests WHERE event_id = $1`, [id.data],
      );
      const guestCount = counts.rows[0].total as number;
      const access = await client.query("SELECT count(*)::int AS total FROM access_events WHERE event_id = $1 AND action IN ('entry', 'exit')", [id.data]);
      const hasAccess = access.rows[0].total > 0;
      if (next.clientId !== old.client_id || next.externalId !== old.external_id) {
        if (next.clientId !== old.client_id && actor.role !== 'adm') {
          await client.query('ROLLBACK'); return reply.code(403).send({ error: 'client_transfer_forbidden' });
        }
        if (guestCount || hasAccess) {
          await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_identity_locked' });
        }
        if (next.clientId !== old.client_id) {
          const target = await client.query('SELECT active FROM clients WHERE id = $1', [next.clientId]);
          if (!target.rowCount || !target.rows[0].active) {
            await client.query('ROLLBACK'); return reply.code(400).send({ error: 'invalid_client_id' });
          }
        }
      }
      const material = newStart !== oldStart || newEnd !== oldEnd
        || next.venue !== old.venue || next.timezone !== old.timezone;
      const onlyEndExtension = newStart === oldStart && newEnd > oldEnd
        && next.venue === old.venue && next.timezone === old.timezone;
      if (hasAccess && material && !onlyEndExtension) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_has_access_history' });
      }
      if (guestCount && material && !value.reason) {
        await client.query('ROLLBACK'); return reply.code(400).send({ error: 'change_reason_required' });
      }
      const before = { clientId: old.client_id, externalId: old.external_id, name: old.name,
        startsAt: old.starts_at, endsAt: old.ends_at, timezone: old.timezone, venue: old.venue, status: old.status };
      if (!material && next.clientId === before.clientId && next.externalId === before.externalId && next.name === before.name) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_unchanged' });
      }
      const requiresReconfirmation = material && !onlyEndExtension;
      const revision = old.revision + (requiresReconfirmation ? 1 : 0);
      const updated = await client.query(
        `UPDATE events SET client_id = $2, external_id = $3, name = $4, starts_at = $5,
           ends_at = $6, timezone = $7, venue = $8, revision = $9 WHERE id = $1
         RETURNING id, client_id AS "clientId", external_id AS "externalId", name, status,
           starts_at AS "startsAt", ends_at AS "endsAt", timezone, venue, revision`,
        [id.data, next.clientId, next.externalId, next.name, next.startsAt, next.endsAt, next.timezone, next.venue, revision],
      );
      let reconfirmationCount = 0;
      if (requiresReconfirmation) {
        const invalidated = await client.query(
          `UPDATE guests SET invitation_status = 'reconfirmation_pending'
           WHERE event_id = $1 AND deleted_at IS NULL AND invitation_status = 'accepted' RETURNING id`, [id.data],
        );
        reconfirmationCount = invalidated.rowCount ?? 0;
      }
      await client.query(
        `INSERT INTO event_changes (event_id, revision, changed_by, action, reason, before_data, after_data, reconfirmation_required)
         VALUES ($1, $2, $3, 'updated', $4, $5, $6, $7)`,
        [id.data, revision, actor.id === 'browser-demo' ? null : actor.id,
          value.reason ?? 'Atualização administrativa do evento', JSON.stringify(before), JSON.stringify(updated.rows[0]), requiresReconfirmation],
      );
      await client.query('COMMIT');
      return { ...updated.rows[0], reconfirmationCount,
        notificationRequired: material && (counts.rows[0].confirmed > 0 || counts.rows[0].sent > 0) };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'event_external_id_exists' });
      throw error;
    } finally { client.release(); }
  });

  app.delete('/v1/events/:eventId', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword || actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const id = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    if (!id.success) return reply.code(400).send({ error: 'invalid_event_id' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const event = await client.query('SELECT client_id, status FROM events WHERE id = $1 FOR UPDATE', [id.data]);
      if (!event.rowCount || !canWriteClient(actor, event.rows[0].client_id)) {
        await client.query('ROLLBACK'); return reply.code(404).send({ error: 'event_not_found' });
      }
      const history = await client.query(
        `SELECT EXISTS (SELECT 1 FROM guests WHERE event_id = $1) AS guests,
                EXISTS (SELECT 1 FROM audit_events WHERE event_id = $1) AS audit,
                EXISTS (SELECT 1 FROM access_events WHERE event_id = $1) AS access`, [id.data],
      );
      if (event.rows[0].status !== 'draft' || history.rows[0].guests || history.rows[0].audit || history.rows[0].access) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_delete_forbidden' });
      }
      await client.query('DELETE FROM event_changes WHERE event_id = $1', [id.data]);
      await client.query('DELETE FROM events WHERE id = $1', [id.data]);
      await client.query('COMMIT');
      return { status: 'deleted', eventId: id.data };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });

  app.post('/v1/events/:eventId/cancel', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword || actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const id = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    const parsed = reasonSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [id.data]);
      if (!found.rowCount || !canWriteClient(actor, found.rows[0].client_id)) {
        await client.query('ROLLBACK'); return reply.code(404).send({ error: 'event_not_found' });
      }
      const old = found.rows[0];
      if (['finished', 'cancelled'].includes(old.status)) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_immutable' });
      }
      const result = await client.query(
        `UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1
         RETURNING id, status, cancelled_at AS "cancelledAt"`, [id.data],
      );
      await client.query(
        `INSERT INTO event_changes (event_id, revision, changed_by, action, reason, before_data, after_data)
         VALUES ($1, $2, $3, 'cancelled', $4, $5, $6)`,
        [id.data, old.revision, actor.id === 'browser-demo' ? null : actor.id,
          parsed.data.reason, JSON.stringify(old), JSON.stringify(result.rows[0])],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  });
}
