'use client';

import { useState } from 'react';

type Event = { id: string; name: string; status: string };
type Guest = { id: string; name: string; invitationUrl: string };
type Access = { action: string; reason: string | null; guestName: string | null; createdAt: string };

async function send(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Erro HTTP ${response.status}`);
  return value;
}

export default function ManagerHome() {
  const [event, setEvent] = useState<Event | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [history, setHistory] = useState<Access[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro inesperado'); }
    finally { setBusy(false); }
  }

  return <main>
    <h1>BioFacial Manager</h1>
    <p>Fluxo de demonstração com banco de desenvolvimento e identidade facial simulada.</p>
    <section><h2>1. Criar evento</h2>
      <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(async () => {
        const created = await send('/api/events', 'POST', {
          name: data.get('name'), venue: data.get('venue'), timezone: 'America/Sao_Paulo',
          startsAt: new Date(String(data.get('startsAt'))).toISOString(),
          endsAt: new Date(String(data.get('endsAt'))).toISOString(),
        }); setEvent(created); setGuest(null); setHistory([]);
      }); }}>
        <label>Nome <input name="name" required minLength={3} defaultValue="Evento teste no navegador" /></label><br />
        <label>Local <input name="venue" required defaultValue="Ambiente de testes" /></label><br />
        <label>Início <input name="startsAt" type="datetime-local" required /></label><br />
        <label>Fim <input name="endsAt" type="datetime-local" required /></label><br />
        <button disabled={busy}>Criar evento</button>
      </form>
    </section>
    {event && <section><h2>2. Convidar alguém</h2><p>Evento: {event.name} ({event.status})</p>
      <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(async () => {
        setGuest(await send(`/api/events/${event.id}/guests`, 'POST', { name: data.get('name'), email: data.get('email') }));
      }); }}>
        <label>Nome <input name="name" required minLength={2} defaultValue="Convidado de teste" /></label><br />
        <label>Email de teste <input name="email" type="email" required placeholder="convidado@example.invalid" /></label><br />
        <button disabled={busy}>Gerar convite</button>
      </form>
      {guest && <p>Link exclusivo: <a href={guest.invitationUrl} target="_blank" rel="noreferrer">Abrir convite de {guest.name}</a></p>}
      <button disabled={busy || event.status === 'active'} onClick={() => void run(async () => {
        const updated = await send(`/api/events/${event.id}/activate`, 'POST'); setEvent({ ...event, status: updated.status });
      })}>Ativar evento</button>
      <p><a href={`http://localhost:3003/?eventId=${event.id}`} target="_blank" rel="noreferrer">Abrir Scanner deste evento</a></p>
      <button disabled={busy} onClick={() => void run(async () => {
        const data = await send(`/api/events/${event.id}/access-events`); setHistory(data.items);
      })}>Atualizar histórico de acesso</button>
      <ol>{history.map(item => <li key={`${item.createdAt}-${item.action}`}>{item.action} — {item.guestName ?? item.reason} — {new Date(item.createdAt).toLocaleString('pt-BR')}</li>)}</ol>
    </section>}
    {error && <p role="alert" style={{ color: 'darkred' }}>{error}</p>}
  </main>;
}
