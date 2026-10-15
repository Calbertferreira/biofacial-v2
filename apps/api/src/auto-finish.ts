import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const CHECK_INTERVAL_MS = 5_000;

export async function finishExpiredEvents(db: pg.Pool): Promise<number> {
  const result = await db.query(
    `WITH finished AS (
       UPDATE events SET status = 'finished'
        WHERE status IN ('draft', 'published', 'active') AND ends_at <= now()
        RETURNING id, ends_at
     )
     INSERT INTO audit_events (event_id, action, details)
       SELECT id, 'event_auto_finished', jsonb_build_object('scheduledEnd', ends_at)
         FROM finished
     RETURNING event_id`,
  );
  return result.rowCount ?? 0;
}

export function registerAutoFinish(app: FastifyInstance, db: pg.Pool): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  async function sweep(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const count = await finishExpiredEvents(db);
      if (count > 0) app.log.info({ count }, 'Eventos encerrados automaticamente');
    } catch (error) {
      app.log.error({ err: error }, 'Falha ao encerrar eventos vencidos; nova tentativa agendada');
    } finally {
      running = false;
    }
  }

  app.addHook('onReady', async () => {
    await sweep();
    timer = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => { if (timer) clearInterval(timer); });
}
