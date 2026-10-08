import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { actorFor, canReadClient, hashPassword } from './security.js';

const uuid = z.uuid();
const clientSchema = z.object({ name: z.string().trim().min(2).max(160), externalId: z.string().trim().min(1).max(120).optional() });
const clientUpdateSchema = clientSchema.partial().extend({ active: z.boolean().optional() }).refine(value => Object.keys(value).length > 0);
const userSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.email(),
  role: z.enum(['adm', 'staff', 'gestor']),
  clientIds: z.array(uuid).max(100).default([]),
  temporaryPassword: z.string().min(12).max(128),
}).refine(value => value.role === 'gestor' ? value.clientIds.length > 0 : value.clientIds.length === 0, {
  message: 'Gestores precisam de clientes; adm e staff não usam vínculos.', path: ['clientIds'],
}).refine(value => new Set(value.clientIds).size === value.clientIds.length, {
  message: 'Clientes duplicados.', path: ['clientIds'],
});
const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  email: z.email().optional(),
  role: z.enum(['adm', 'staff', 'gestor']).optional(),
  clientIds: z.array(uuid).max(100).optional(),
  active: z.boolean().optional(),
  temporaryPassword: z.string().min(12).max(128).optional(),
}).refine(value => Object.keys(value).length > 0);

export function registerManagement(app: FastifyInstance, db: pg.Pool): void {
  app.post('/v1/clients', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    if (actor.role !== 'adm') return reply.code(403).send({ error: 'forbidden' });
    const parsed = clientSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    const { name, externalId } = parsed.data;
    const result = await db.query(
      `INSERT INTO clients (name, external_id) VALUES ($1, $2)
       ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id, name, external_id AS "externalId", active`, [name, externalId ?? null],
    );
    return reply.code(201).send(result.rows[0]);
  });

  app.get('/v1/clients', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    const result = actor.role === 'gestor'
      ? await db.query(`SELECT id, name, external_id AS "externalId", active FROM clients WHERE id = ANY($1::uuid[]) ORDER BY name`, [actor.clientIds])
      : await db.query(`SELECT id, name, external_id AS "externalId", active FROM clients ORDER BY name`);
    return { items: result.rows };
  });

  app.patch('/v1/clients/:clientId', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    if (actor.role !== 'adm') return reply.code(403).send({ error: 'forbidden' });
    const id = uuid.safeParse((request.params as { clientId?: string }).clientId);
    const parsed = clientUpdateSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const result = await db.query(
      `UPDATE clients SET name = COALESCE($2, name), external_id = COALESCE($3, external_id),
                          active = COALESCE($4, active), updated_at = now()
       WHERE id = $1 RETURNING id, name, external_id AS "externalId", active`,
      [id.data, parsed.data.name ?? null, parsed.data.externalId ?? null, parsed.data.active ?? null],
    );
    if (!result.rowCount) return reply.code(404).send({ error: 'client_not_found' });
    return result.rows[0];
  });

  app.post('/v1/users', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    if (actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const parsed = userSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() });
    const data = parsed.data;
    if (actor.role === 'gestor' && (data.role !== 'gestor' || data.clientIds.some(id => !actor.clientIds.includes(id)))) {
      return reply.code(403).send({ error: 'forbidden_client_or_role' });
    }
    if (data.role === 'gestor') {
      const existing = await db.query(`SELECT id FROM clients WHERE id = ANY($1::uuid[]) AND active`, [data.clientIds]);
      if (existing.rowCount !== data.clientIds.length) return reply.code(400).send({ error: 'invalid_client_ids' });
    }
    const passwordHash = await hashPassword(data.temporaryPassword);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `INSERT INTO app_users (name, email, password_hash, role) VALUES ($1, lower($2), $3, $4)
         RETURNING id, name, email, role, active, must_change_password AS "mustChangePassword"`,
        [data.name, data.email, passwordHash, data.role],
      );
      for (const clientId of data.clientIds) {
        await client.query(`INSERT INTO user_clients (user_id, client_id, granted_by) VALUES ($1, $2, $3)`, [created.rows[0].id, clientId, actor.id === 'browser-demo' ? null : actor.id]);
      }
      await client.query('COMMIT');
      return reply.code(201).send({ ...created.rows[0], clientIds: data.clientIds });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'email_already_exists' });
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/v1/users', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    const result = actor.role === 'gestor'
      ? await db.query(
        `SELECT u.id, u.name, u.email, u.role, u.active,
                COALESCE(array_agg(uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '{}') AS "clientIds"
           FROM app_users u JOIN user_clients uc ON uc.user_id = u.id AND uc.client_id = ANY($1::uuid[])
          WHERE u.role = 'gestor' AND EXISTS (
            SELECT 1 FROM user_clients x WHERE x.user_id = u.id AND x.client_id = ANY($1::uuid[]))
          GROUP BY u.id ORDER BY u.name`, [actor.clientIds],
      )
      : await db.query(
        `SELECT u.id, u.name, u.email, u.role, u.active,
                COALESCE(array_agg(uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '{}') AS "clientIds"
           FROM app_users u LEFT JOIN user_clients uc ON uc.user_id = u.id
          GROUP BY u.id ORDER BY u.name`,
      );
    return { items: result.rows };
  });

  app.patch('/v1/users/:userId', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    if (actor.role !== 'adm') return reply.code(403).send({ error: 'forbidden' });
    const id = uuid.safeParse((request.params as { userId?: string }).userId);
    const parsed = userUpdateSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const data = parsed.data;
    const passwordHash = data.temporaryPassword ? await hashPassword(data.temporaryPassword) : null;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('biofacial_admins'))");
      const current = await client.query(`SELECT id, role, active FROM app_users WHERE id = $1 FOR UPDATE`, [id.data]);
      if (!current.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'user_not_found' }); }
      const nextRole = data.role ?? current.rows[0].role;
      const nextActive = data.active ?? current.rows[0].active;
      if (current.rows[0].role === 'adm' && current.rows[0].active && (nextRole !== 'adm' || !nextActive)) {
        const count = await client.query(`SELECT count(*)::int AS total FROM app_users WHERE role = 'adm' AND active`);
        if (count.rows[0].total <= 1) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'last_admin' }); }
      }
      const currentLinks = await client.query(`SELECT client_id FROM user_clients WHERE user_id = $1`, [id.data]);
      const nextClientIds: string[] = nextRole === 'gestor'
        ? (data.clientIds ?? currentLinks.rows.map(row => row.client_id)) : [];
      if (nextRole === 'gestor' && (nextClientIds.length === 0 || new Set(nextClientIds).size !== nextClientIds.length)) {
        await client.query('ROLLBACK'); return reply.code(400).send({ error: 'invalid_client_ids' });
      }
      if (nextRole !== 'gestor' && data.clientIds?.length) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'invalid_client_ids' }); }
      if (nextClientIds.length) {
        const valid = await client.query(`SELECT id FROM clients WHERE id = ANY($1::uuid[]) AND active`, [nextClientIds]);
        if (valid.rowCount !== nextClientIds.length) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'invalid_client_ids' }); }
      }
      const updated = await client.query(
        `UPDATE app_users SET name = COALESCE($2, name), email = COALESCE(lower($3), email), role = $4,
                              active = $5, password_hash = COALESCE($6, password_hash),
                              must_change_password = CASE WHEN $6::text IS NOT NULL THEN true ELSE must_change_password END,
                              updated_at = now()
         WHERE id = $1 RETURNING id, name, email, role, active, must_change_password AS "mustChangePassword"`,
        [id.data, data.name ?? null, data.email ?? null, nextRole, nextActive, passwordHash],
      );
      await client.query(`DELETE FROM user_clients WHERE user_id = $1`, [id.data]);
      for (const clientId of nextClientIds) {
        await client.query(`INSERT INTO user_clients (user_id, client_id, granted_by) VALUES ($1, $2, $3)`, [id.data, clientId, actor.id === 'browser-demo' ? null : actor.id]);
      }
      if (data.role !== undefined || data.active !== undefined || passwordHash) {
        await client.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1`, [id.data]);
      }
      await client.query('COMMIT');
      return { ...updated.rows[0], clientIds: nextClientIds };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'code' in error && error.code === '23505') return reply.code(409).send({ error: 'email_already_exists' });
      throw error;
    } finally { client.release(); }
  });

  app.get('/v1/events', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    const result = actor.role === 'gestor'
      ? await db.query(`SELECT id, client_id AS "clientId", name, status, starts_at AS "startsAt", ends_at AS "endsAt", timezone, venue FROM events WHERE client_id = ANY($1::uuid[]) ORDER BY starts_at DESC LIMIT 500`, [actor.clientIds])
      : await db.query(`SELECT id, client_id AS "clientId", name, status, starts_at AS "startsAt", ends_at AS "endsAt", timezone, venue FROM events ORDER BY starts_at DESC LIMIT 500`);
    return { items: result.rows };
  });

  app.get('/v1/events/:eventId', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    const id = uuid.safeParse((request.params as { eventId?: string }).eventId);
    if (!id.success) return reply.code(400).send({ error: 'invalid_event_id' });
    const result = await db.query(`SELECT id, client_id AS "clientId", name, status, starts_at AS "startsAt", ends_at AS "endsAt", venue FROM events WHERE id = $1`, [id.data]);
    if (!result.rowCount || !canReadClient(actor, result.rows[0].clientId)) return reply.code(404).send({ error: 'event_not_found' });
    return result.rows[0];
  });

  app.get('/v1/events/:eventId/guests', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword) return reply.code(403).send({ error: 'password_change_required' });
    const id = uuid.safeParse((request.params as { eventId?: string }).eventId);
    if (!id.success) return reply.code(400).send({ error: 'invalid_event_id' });
    const event = await db.query(`SELECT client_id FROM events WHERE id = $1`, [id.data]);
    if (!event.rowCount || !canReadClient(actor, event.rows[0].client_id)) return reply.code(404).send({ error: 'event_not_found' });
    const result = await db.query(
      `SELECT g.id, g.name, g.email, g.phone_e164 AS "phoneE164", g.invitation_status AS "invitationStatus",
              g.accepted_at AS "acceptedAt", g.send_attempts AS "sendAttempts",
              COALESCE((SELECT json_agg(json_build_object('id', d.id, 'attemptNumber', d.attempt_number,
                'channel', d.channel, 'status', d.status, 'createdAt', d.created_at,
                'providerMessageId', d.provider_message_id, 'error', d.error_message)
                ORDER BY d.created_at DESC) FROM invitation_deliveries d WHERE d.guest_id = g.id), '[]'::json) AS deliveries
       FROM guests g WHERE g.event_id = $1 ORDER BY g.created_at DESC LIMIT 500`, [id.data],
    );
    return { items: result.rows };
  });
}
