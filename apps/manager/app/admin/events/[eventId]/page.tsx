'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Event = { id: string; name: string; status: string; startsAt: string; endsAt: string; venue: string };
type Guest = { id: string; name: string; email: string | null; phoneE164: string | null; invitationStatus: string };
type Access = { id: string; action: string; reason: string | null; guestName: string | null; createdAt: string };

async function api(path: string, method = 'GET', payload?: unknown) {
  const response = await fetch(path, { method, headers: payload ? { 'content-type': 'application/json' } : undefined, body: payload ? JSON.stringify(payload) : undefined });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export default function EventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [invitationUrl, setInvitationUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const root = `/api/manage/events/${eventId}`;
    const [detail, guestList, history] = await Promise.all([api(root), api(`${root}/guests`), api(`${root}/access-events`)]);
    setEvent(detail); setGuests(guestList.items); setAccess(history.items);
  }, [eventId]);
  useEffect(() => { void load().catch(cause => setError(cause.message)); }, [load]);
  async function action(task: () => Promise<void>) {
    setBusy(true); setError('');
    try { await task(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro inesperado'); }
    finally { setBusy(false); }
  }
  return <main className="eventDetail"><a href="/admin#eventos">← Voltar aos eventos</a><header><span className="adminEyebrow">OPERAÇÃO DO EVENTO</span><h1>{event?.name ?? 'Carregando evento...'}</h1><p>{event?.venue} · {event?.startsAt && new Date(event.startsAt).toLocaleString('pt-BR')} · Situação: <strong>{event?.status}</strong></p></header>
    {error && <p role="alert" className="adminError">{error}</p>}
    <section className="eventActions"><h2>Operação</h2><button disabled={busy} onClick={() => void action(load)}>Atualizar</button>{event?.status === 'draft' && <button disabled={busy} onClick={() => void action(async () => { await api(`/api/manage/events/${eventId}/activate`, 'POST'); })}>Ativar evento</button>}{event?.status === 'active' && <button disabled={busy} onClick={() => void action(async () => { await api(`/api/manage/events/${eventId}/finish`, 'POST'); })}>Finalizar evento</button>}<p>Scanner: <a href={`${process.env.NEXT_PUBLIC_SCANNER_URL ?? 'http://localhost:3003'}/?eventId=${eventId}`} target="_blank" rel="noreferrer">abrir terminal deste evento ↗</a></p></section>
    <section><h2>Convidar pessoa</h2><form onSubmit={submit => { submit.preventDefault(); const formElement = submit.currentTarget; const form = new FormData(formElement); void action(async () => {
      const guest = await api(`/api/manage/events/${eventId}/guests`, 'POST', { name: form.get('name'), email: form.get('email') || undefined, phoneE164: form.get('phoneE164') || undefined });
      setInvitationUrl(guest.invitationUrl); formElement.reset();
    }); }}><label>Nome<input name="name" required minLength={2} /></label><label>E-mail<input name="email" type="email" /></label><label>Telefone (+55...)<input name="phoneE164" type="tel" /></label><button disabled={busy}>Gerar convite</button></form>
      {invitationUrl && <div className="eventInvite" role="status"><strong>Link individual criado</strong><input value={invitationUrl} readOnly aria-label="Link do convite" /><button onClick={() => void navigator.clipboard.writeText(invitationUrl)}>Copiar link</button><a href={invitationUrl} target="_blank" rel="noreferrer">Abrir convite ↗</a></div>}
      <h3>Convidados ({guests.length})</h3><ul>{guests.map(guest => <li key={guest.id}>{guest.name} · {guest.email ?? guest.phoneE164} · {guest.invitationStatus === 'accepted' ? 'confirmado' : 'pendente'}</li>)}</ul>
    </section><section><h2>Histórico de acesso</h2><p>{access.filter(item => item.action === 'entry').length} entradas · {access.filter(item => item.action === 'exit').length} saídas · {access.filter(item => item.action === 'denied').length} tentativas negadas</p><ul>{access.slice().reverse().map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleString('pt-BR')} · {item.action === 'entry' ? 'Entrada' : item.action === 'exit' ? 'Saída' : 'Negado'} · {item.guestName ?? item.reason ?? 'desconhecido'}</li>)}</ul></section>
  </main>;
}
