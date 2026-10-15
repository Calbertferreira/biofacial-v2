import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { actorFor, canWriteClient } from './security.js';

const sendSchema = z.object({ guestIds: z.array(z.uuid()).min(1).max(100), channels: z.array(z.enum(['email', 'whatsapp'])).min(1).max(2),
  purpose: z.enum(['invitation', 'event_change', 'event_cancelled']).default('invitation') })
  .refine(value => new Set(value.guestIds).size === value.guestIds.length && new Set(value.channels).size === value.channels.length);
const eventIdSchema = z.uuid();
type Channel = 'email' | 'whatsapp';

async function deliver(channel: Channel, destination: string, invitationUrl: string, eventName: string,
  guestName: string, deliveryId: string, purpose: 'invitation' | 'event_change' | 'event_cancelled',
  eventDetails: string, reconfirmationRequired: boolean): Promise<string | null> {
  if (channel === 'email') {
    if (!process.env.RESEND_API_KEY || !process.env.INVITATION_EMAIL_FROM) throw new Error('email_not_configured');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'Idempotency-Key': deliveryId },
      body: JSON.stringify({ from: process.env.INVITATION_EMAIL_FROM, to: [destination],
        subject: purpose === 'event_cancelled' ? `Evento cancelado: ${eventName}`
          : purpose === 'event_change' && reconfirmationRequired ? `Alteração no evento ${eventName}: confirme sua presença`
          : purpose === 'event_change' ? `Atualização no evento ${eventName}` : `Convite para ${eventName}`,
        text: purpose === 'event_cancelled'
          ? `Olá, ${guestName}. O evento ${eventName} foi cancelado. Consulte o organizador para orientações e informações atualizadas.`
          : purpose === 'event_change' && reconfirmationRequired
          ? `Olá, ${guestName}. A data, o horário ou o local de ${eventName} foi alterado. ${eventDetails}. Abra seu convite para conferir os dados e confirmar novamente sua presença ou informar que não poderá comparecer: ${invitationUrl}`
          : purpose === 'event_change'
          ? `Olá, ${guestName}. As informações de ${eventName} foram atualizadas. ${eventDetails}. Confira seu convite: ${invitationUrl}. Se você já confirmou a presença, seu aceite continua válido.`
          : `Olá, ${guestName}. Você foi convidado para ${eventName}. Acesse seu convite: ${invitationUrl}` }),
    });
    if (!response.ok) throw new Error(`email_provider_http_${response.status}`);
    const body = await response.json() as { id?: string };
    return body.id ?? null;
  }
  const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME, WHATSAPP_UPDATE_TEMPLATE_NAME,
    WHATSAPP_INFO_TEMPLATE_NAME, WHATSAPP_CANCEL_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANGUAGE, WHATSAPP_GRAPH_VERSION } = process.env;
  const templateName = purpose === 'event_cancelled' ? WHATSAPP_CANCEL_TEMPLATE_NAME
    : purpose === 'event_change' && reconfirmationRequired ? WHATSAPP_UPDATE_TEMPLATE_NAME
    : purpose === 'event_change' ? WHATSAPP_INFO_TEMPLATE_NAME : WHATSAPP_TEMPLATE_NAME;
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !templateName || !WHATSAPP_TEMPLATE_LANGUAGE || !WHATSAPP_GRAPH_VERSION)
    throw new Error(purpose === 'event_cancelled' ? 'event_cancel_whatsapp_not_configured'
      : purpose === 'event_change' && reconfirmationRequired ? 'event_update_whatsapp_not_configured'
      : purpose === 'event_change' ? 'event_info_whatsapp_not_configured' : 'whatsapp_not_configured');
  const response = await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destination.replace(/\D/g, ''), type: 'template',
      template: { name: templateName, language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{ type: 'body', parameters: [{ type: 'text', text: guestName }, { type: 'text', text: eventName },
          { type: 'text', text: purpose === 'event_cancelled' ? eventDetails : invitationUrl }] }] } }),
  });
  if (!response.ok) throw new Error(`whatsapp_provider_http_${response.status}`);
  const body = await response.json() as { messages?: { id?: string }[] };
  return body.messages?.[0]?.id ?? null;
}

export function registerInvitationDelivery(app: FastifyInstance, db: pg.Pool, publicBaseUrl?: string): void {
  app.post('/v1/events/:eventId/invitations/send', async (request, reply) => {
    const actor = await actorFor(request, db);
    if (!actor) return reply.code(401).send({ error: 'unauthorized' });
    if (actor.mustChangePassword || actor.role === 'staff') return reply.code(403).send({ error: 'forbidden' });
    const eventId = eventIdSchema.safeParse((request.params as { eventId?: string }).eventId);
    const parsed = sendSchema.safeParse(request.body);
    if (!eventId.success || !parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!publicBaseUrl) return reply.code(503).send({ error: 'invitation_app_unavailable' });
    const event = await db.query('SELECT name, client_id, status, starts_at, timezone, venue, revision FROM events WHERE id = $1', [eventId.data]);
    if (!event.rowCount || !canWriteClient(actor, event.rows[0].client_id)) return reply.code(404).send({ error: 'event_not_found' });
    if (event.rows[0].status === 'finished'
      || (event.rows[0].status === 'cancelled') !== (parsed.data.purpose === 'event_cancelled'))
      return reply.code(409).send({ error: 'event_unavailable' });
    if (parsed.data.purpose === 'event_change') {
      const change = await db.query(
        `SELECT 1 FROM event_changes
         WHERE event_id = $1 AND revision = $2 AND action = 'updated'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [eventId.data, event.rows[0].revision],
      );
      if (!change.rowCount) return reply.code(409).send({ error: 'event_change_not_found' });
    }
    const eventDetails = `${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: event.rows[0].timezone }).format(new Date(event.rows[0].starts_at))}; local: ${event.rows[0].venue}`;
    const results: { guestId: string; channel: Channel; status: 'sent' | 'failed'; error?: string }[] = [];
    for (const guestId of parsed.data.guestIds) {
      const client = await db.connect();
      let pending: { id: string; channel: Channel; destination: string; reconfirmationRequired: boolean }[] = [];
      let invitationUrl = '';
      try {
        await client.query('BEGIN');
        const currentEvent = await client.query('SELECT revision, status FROM events WHERE id = $1 FOR SHARE', [eventId.data]);
        if (!currentEvent.rowCount || currentEvent.rows[0].revision !== event.rows[0].revision
          || currentEvent.rows[0].status !== event.rows[0].status) {
          await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_changed_during_send' });
        }
        const selected = await client.query('SELECT id, name, email, phone_e164, invitation_status, send_attempts FROM guests WHERE id = $1 AND event_id = $2 AND deleted_at IS NULL FOR UPDATE', [guestId, eventId.data]);
        if (!selected.rowCount) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'guest_not_found', guestId }); }
        const guest = selected.rows[0];
        if (['declined', 'expired'].includes(guest.invitation_status)) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'invitation_unavailable', guestId }); }
        if (parsed.data.purpose === 'event_change' && guest.send_attempts === 0 && !['reconfirmation_pending', 'accepted'].includes(guest.invitation_status)) {
          await client.query('ROLLBACK'); return reply.code(409).send({ error: 'event_change_not_applicable', guestId });
        }
        for (const channel of parsed.data.channels) {
          if (channel === 'email' && !guest.email || channel === 'whatsapp' && !guest.phone_e164) {
            await client.query('ROLLBACK'); return reply.code(400).send({ error: 'missing_destination', guestId, channel });
          }
        }
        if (parsed.data.purpose !== 'event_cancelled') {
          const token = randomBytes(32).toString('hex');
          invitationUrl = new URL(`/convite/${token}`, publicBaseUrl).toString();
          await client.query('INSERT INTO invitation_tokens (token_hash, guest_id) VALUES ($1, $2)', [createHash('sha256').update(token).digest('hex'), guestId]);
        }
        const attempt = guest.send_attempts + 1;
        await client.query('UPDATE guests SET send_attempts = $2 WHERE id = $1', [guestId, attempt]);
        for (const channel of parsed.data.channels) {
          const destination = channel === 'email' ? guest.email : guest.phone_e164;
          const created = await client.query(
            `INSERT INTO invitation_deliveries (guest_id, attempt_number, channel, destination, status, purpose, event_revision)
             VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id`,
            [guestId, attempt, channel, destination, parsed.data.purpose, event.rows[0].revision],
          );
          pending.push({ id: created.rows[0].id, channel, destination,
            reconfirmationRequired: guest.invitation_status === 'reconfirmation_pending' });
        }
        await client.query('COMMIT');
        for (const item of pending) {
          try {
            const providerMessageId = await deliver(item.channel, item.destination, invitationUrl,
              event.rows[0].name, guest.name, item.id, parsed.data.purpose, eventDetails, item.reconfirmationRequired);
            await db.query("UPDATE invitation_deliveries SET status = 'sent', provider_message_id = $2, completed_at = now() WHERE id = $1", [item.id, providerMessageId]);
            await db.query("UPDATE guests SET invitation_status = 'invited' WHERE id = $1 AND deleted_at IS NULL AND invitation_status = 'registered'", [guestId]);
            results.push({ guestId, channel: item.channel, status: 'sent' });
          } catch (cause) {
            const error = cause instanceof Error ? cause.message : 'delivery_failed';
            await db.query("UPDATE invitation_deliveries SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1", [item.id, error]);
            results.push({ guestId, channel: item.channel, status: 'failed', error });
          }
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
    return { items: results };
  });
}
