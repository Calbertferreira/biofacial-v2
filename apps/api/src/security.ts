import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';

const params = { N: 16384, r: 8, p: 1 };
function derive(password: string, salt: Buffer, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, 64, options, (error, key) => {
    if (error) reject(error); else resolve(key as Buffer);
  }));
}

export type Role = 'adm' | 'staff' | 'gestor';
export type Actor = { id: string; name: string; email: string; role: Role; clientIds: string[]; mustChangePassword: boolean; sessionHash?: string };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, Buffer.from(salt, 'hex'), params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hex] = stored.split('$');
  if (algorithm !== 'scrypt' || !n || !r || !p || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  if (expected.length !== 64) return false;
  const actual = await derive(password, Buffer.from(salt, 'hex'), { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function matchesKey(header: string | undefined, key: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(key);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function actorFor(request: FastifyRequest, db: pg.Pool): Promise<Actor | null> {
  const header = request.headers.authorization;
  if (process.env.BROWSER_DEMO === 'true' && process.env.ADMIN_API_KEY && matchesKey(header, process.env.ADMIN_API_KEY)) {
    return { id: 'browser-demo', name: 'Administrador de demonstração', email: 'demo@local', role: 'adm', clientIds: [], mustChangePassword: false };
  }
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const sessionHash = hashToken(token);
  const result = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.must_change_password,
            COALESCE(array_agg(uc.client_id) FILTER (WHERE uc.client_id IS NOT NULL), '{}') AS client_ids
       FROM user_sessions s JOIN app_users u ON u.id = s.user_id
       LEFT JOIN user_clients uc ON uc.user_id = u.id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active
      GROUP BY u.id`, [sessionHash],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: row.id, name: row.name, email: row.email, role: row.role, clientIds: row.client_ids, mustChangePassword: row.must_change_password, sessionHash };
}

export function canReadClient(actor: Actor, clientId: string | null): boolean {
  return actor.role === 'adm' || actor.role === 'staff' || (clientId !== null && actor.clientIds.includes(clientId));
}

export function canWriteClient(actor: Actor, clientId: string | null): boolean {
  return actor.role === 'adm' || (actor.role === 'gestor' && clientId !== null && actor.clientIds.includes(clientId));
}
