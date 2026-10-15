'use client';
import { useState } from 'react';
import { deliveryErrorMessage, requestJson, validateForm } from '../../../feedback';

type Event = { id: string; name: string; status: string; startsAt: string; endsAt: string; timezone: string; venue: string; revision: number };
type Delivery = { channel: 'email' | 'whatsapp'; status: string; purpose: string; eventRevision: number | null };
type Guest = { id: string; email: string | null; phoneE164: string | null; invitationStatus: string;
  sendAttempts: number; deliveries: Delivery[] };
type ChangeResult = Event & { reconfirmationCount: number; notificationRequired: boolean };

function localInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export default function EventEditor({ event, guests, hasAccess, onChanged }: {
  event: Event; guests: Guest[]; hasAccess: boolean; onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const editable = !['finished', 'cancelled'].includes(event.status);
  const sentCount = guests.filter(guest => guest.sendAttempts > 0).length;
  const acceptedCount = guests.filter(guest => guest.invitationStatus === 'accepted').length;
  const pendingCount = guests.filter(guest => guest.invitationStatus === 'reconfirmation_pending').length;
  const failedNotice = guests.some(guest => guest.deliveries.some(delivery =>
    delivery.status === 'failed' && delivery.eventRevision === event.revision
    && ['event_change', 'event_cancelled'].includes(delivery.purpose)));

  async function notifyGuests(purpose: 'event_change' | 'event_cancelled', revision: number, onlyUnsent = false): Promise<string> {
    const recipients = guests.filter(guest => !['declined', 'expired'].includes(guest.invitationStatus)
      && (guest.sendAttempts > 0 || ['accepted', 'attended', 'reconfirmation_pending'].includes(guest.invitationStatus)));
    const byChannel: Record<'email' | 'whatsapp', string[]> = { email: [], whatsapp: [] };
    let withoutContact = 0;
    for (const guest of recipients) {
      const used = new Set(guest.deliveries.filter(delivery => delivery.status === 'sent').map(delivery => delivery.channel));
      if (!used.size) {
        if (guest.email) used.add('email');
        else if (guest.phoneE164) used.add('whatsapp');
      }
      let assigned = false;
      const alreadySent = (channel: 'email' | 'whatsapp') => onlyUnsent && guest.deliveries.some(delivery =>
        delivery.purpose === purpose && delivery.eventRevision === revision
        && delivery.channel === channel && delivery.status === 'sent');
      if (guest.email && used.has('email') && !alreadySent('email')) { byChannel.email.push(guest.id); assigned = true; }
      if (guest.phoneE164 && used.has('whatsapp') && !alreadySent('whatsapp')) { byChannel.whatsapp.push(guest.id); assigned = true; }
      if (!assigned && !(guest.email && used.has('email')) && !(guest.phoneE164 && used.has('whatsapp'))) withoutContact++;
    }
    let sent = 0;
    const failures: string[] = [];
    for (const channel of ['email', 'whatsapp'] as const) {
      for (const group of chunks(byChannel[channel], 100)) {
        try {
          const result = await requestJson<{ items: { status: string; error?: string }[] }>(
            `/api/manage/events/${event.id}/invitations/send`, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ guestIds: group, channels: [channel], purpose }),
            },
          );
          sent += result.items.filter(item => item.status === 'sent').length;
          failures.push(...result.items.filter(item => item.status === 'failed').map(item => deliveryErrorMessage(item.error ?? null)));
        } catch (cause) { failures.push(cause instanceof Error ? cause.message : 'Falha no envio do aviso.'); }
      }
    }
    return `${sent} aviso(s) aceito(s) pelos provedores; ${failures.length} falha(s)${withoutContact ? `; ${withoutContact} sem canal disponível` : ''}.${failures.length ? ` ${[...new Set(failures)].slice(0, 2).join(' ')}` : ''}`;
  }

  async function save(formElement: HTMLFormElement) {
    const problem = validateForm(formElement);
    if (problem) { setError(problem); return; }
    const form = new FormData(formElement);
    const startInput = String(form.get('startsAt'));
    const endInput = String(form.get('endsAt'));
    const startsAt = startInput === localInput(event.startsAt)
      ? new Date(event.startsAt).toISOString() : new Date(startInput).toISOString();
    const endsAt = endInput === localInput(event.endsAt)
      ? new Date(event.endsAt).toISOString() : new Date(endInput).toISOString();
    const venue = String(form.get('venue')).trim();
    const timezone = String(form.get('timezone')).trim();
    const material = startsAt !== new Date(event.startsAt).toISOString()
      || endsAt !== new Date(event.endsAt).toISOString() || venue !== event.venue || timezone !== event.timezone;
    const onlyExtension = startsAt === new Date(event.startsAt).toISOString()
      && new Date(endsAt).getTime() > new Date(event.endsAt).getTime()
      && venue === event.venue && timezone === event.timezone;
    if (hasAccess && material && !onlyExtension) {
      setError('O evento já registrou entradas. Somente ampliar o horário de término é permitido.'); return;
    }
    const reason = String(form.get('reason')).trim();
    if (material && guests.length && reason.length < 10) {
      setError('Explique a alteração em pelo menos 10 caracteres.'); return;
    }
    if (material && (sentCount || acceptedCount)
      && !window.confirm(`Esta alteração afeta ${acceptedCount} aceite(s) e ${sentCount} convidado(s) com envio registrado. Os aceites anteriores precisarão de reconfirmação quando data, horário ou local mudarem. Deseja continuar?`)) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      const result = await requestJson<ChangeResult>(`/api/manage/events/${event.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: String(form.get('name')).trim(), startsAt, endsAt, timezone, venue,
          ...(reason ? { reason } : {}) }),
      });
      setEditing(false);
      let notice = '';
      if (result.notificationRequired) notice = ` ${await notifyGuests('event_change', result.revision)}`;
      setFeedback(`Evento atualizado. ${result.reconfirmationCount} convidado(s) aguardam reconfirmação.${notice}`);
      try { await onChanged(); }
      catch { setError('A alteração foi salva, mas não foi possível atualizar a lista. Recarregue a página.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o evento.'); }
    finally { setBusy(false); }
  }

  async function cancel() {
    const reason = window.prompt('Motivo do cancelamento (mínimo de 10 caracteres):')?.trim();
    if (!reason) return;
    if (reason.length < 10) { setError('Descreva o motivo do cancelamento em pelo menos 10 caracteres.'); return; }
    if (!window.confirm('Cancelar este evento? Convites deixarão de aceitar respostas e o Scanner não registrará novos acessos.')) return;
    setBusy(true); setError(''); setFeedback('');
    try {
      await requestJson(`/api/manage/events/${event.id}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }),
      });
      const notice = await notifyGuests('event_cancelled', event.revision);
      setFeedback(`Evento cancelado. ${notice}`);
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cancelar o evento.'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Excluir definitivamente este rascunho sem convidados?')) return;
    setBusy(true); setError('');
    try {
      await requestJson(`/api/manage/events/${event.id}`, { method: 'DELETE' });
      window.location.assign('/admin#eventos');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir o evento.'); setBusy(false); }
  }

  async function retryNotices() {
    setBusy(true); setError(''); setFeedback('');
    try {
      const purpose = event.status === 'cancelled' ? 'event_cancelled' : 'event_change';
      setFeedback(await notifyGuests(purpose, event.revision, true));
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível reenviar os avisos.'); }
    finally { setBusy(false); }
  }

  return <section className="eventEditor"><h2>Dados do evento</h2>
    {feedback && <p role="status" className="adminSuccess">{feedback}</p>}
    {error && <p role="alert" className="adminError">{error}</p>}
    <p>Versão {event.revision}. {acceptedCount} presença(s) confirmada(s) e {pendingCount} aguardando reconfirmação.</p>
    {failedNotice && <button type="button" className="secondary" disabled={busy} onClick={() => void retryNotices()}>Reenviar avisos com falha</button>}
    {editable && <div className="eventEditorActions"><button type="button" disabled={busy} onClick={() => { setEditing(current => !current); setError(''); }}>{editing ? 'Fechar edição' : 'Editar evento'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => void cancel()}>Cancelar evento</button>
      {event.status === 'draft' && guests.length === 0 && !hasAccess && <button type="button" className="secondary" disabled={busy} onClick={() => void remove()}>Excluir rascunho</button>}</div>}
    {editing && <form key={`${event.id}-${event.revision}-${event.startsAt}`} noValidate onSubmit={submit => { submit.preventDefault(); void save(submit.currentTarget); }}>
      <label>Nome<input name="name" required minLength={3} maxLength={160} defaultValue={event.name} /></label>
      <label>Início no fuso deste dispositivo<input name="startsAt" type="datetime-local" required defaultValue={localInput(event.startsAt)} /></label>
      <label>Fim no fuso deste dispositivo<input name="endsAt" type="datetime-local" required defaultValue={localInput(event.endsAt)} /></label>
      <label>Fuso do evento<input name="timezone" required maxLength={80} defaultValue={event.timezone} /></label>
      <label>Local e endereço<input name="venue" required maxLength={240} defaultValue={event.venue} /></label>
      <label className="fieldFull">Motivo da alteração<textarea name="reason" minLength={10} maxLength={500} placeholder="Obrigatório ao mudar data, horário ou local de um evento com convidados" /></label>
      <p className="fieldFull">Data, horário, fuso ou local alterados exigem nova confirmação dos convidados que já aceitaram. A foto cadastrada é preservada.</p>
      <button type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar alterações'}</button>
    </form>}
  </section>;
}
