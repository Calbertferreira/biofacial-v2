import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { actorFor, hashPassword, hashToken, newToken, verifyPassword } from './security.js';

const loginSchema = z.object({ email: z.email(), password: z.string().min(1).max(128) });
const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(128) });

export function registerAuth(app: FastifyInstance, db: pg.Pool): void {
  app.post('/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const email = parsed.data.email.trim().toLowerCase();
    const result = await db.query(
      `SELECT id, name, email, role, password_hash, active, must_change_password, failed_logins, locked_until
       FROM app_users WHERE lower(email) = $1`, [email],
    );
    const user = result.rows[0];
    if (!user) {
      await hashPassword(parsed.data.password);
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    if (!user.active) return reply.code(401).send({ error: 'invalid_credentials' });
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      return reply.code(429).send({ error: 'temporarily_locked' });
    }
    if (!(await verifyPassword(parsed.data.password, user.password_hash))) {
      await db.query(
        `UPDATE app_users SET failed_logins = failed_logins + 1,
         locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END
         WHERE id = $1`, [user.id],
      );
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    await db.query(`UPDATE app_users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [user.id]);
    const token = newToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await db.query(`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [hashToken(token), user.id, expiresAt]);
    reply.header('Cache-Control', 'no-store');
    return { accessToken: token, tokenType: 'Bearer', expiresAt: expiresAt.toISOString(), user: {
      id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.must_change_password,
    } };
  });

  app.get('/v1/auth/me', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('Cache-Control', 'no-store');
    return { id: actor.id, name: actor.name, email: actor.email, role: actor.role, clientIds: actor.clientIds, mustChangePassword: actor.mustChangePassword };
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor?.sessionHash) return reply.code(401).send({ error: 'unauthorized' });
    await db.query(`UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1`, [actor.sessionHash]);
    return { status: 'logged_out' };
  });

  app.post('/v1/auth/change-password', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor?.sessionHash) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = changeSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.currentPassword === parsed.data.newPassword) return reply.code(400).send({ error: 'invalid_input' });
    const result = await db.query(`SELECT password_hash FROM app_users WHERE id = $1`, [actor.id]);
    if (!result.rowCount || !(await verifyPassword(parsed.data.currentPassword, result.rows[0].password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const passwordHash = await hashPassword(parsed.data.newPassword);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE app_users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1`, [actor.id, passwordHash]);
      await client.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1`, [actor.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { status: 'password_changed', loginRequired: true };
  });
}
