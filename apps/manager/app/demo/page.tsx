'use client';

import { useState } from 'react';
import { accessReasonMessage, requestJson, validateForm } from '../feedback';

type Event = { id: string; name: string; status: string };
type Guest = { id: string; name: string; invitationUrl: string };
type Access = { action: string; reason: string | null; guestName: string | null; createdAt: string };

async function send(path: string, method = 'GET', body?: unknown) {
  return requestJson(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
}

export default function ManagerHome() {
  const [event, setEvent] = useState<Event | null>(null);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [history, setHistory] = useState<Access[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(task: () => Promise<void>) {
    setError(''); setMessage(''); setBusy(true);
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação. Tente novamente.'); }
    finally { setBusy(false); }
  }

  return <main className="demoPage">
    <h1>BioFacial Manager</h1>
    <p>Fluxo de demonstração com banco de desenvolvimento e identidade facial simulada.</p>
    <section><h2>1. Criar evento</h2>
      <form noValidate onSubmit={e => { e.preventDefault(); const problem = validateForm(e.currentTarget); if (problem) { setMessage(''); setError(problem); return; } const data = new FormData(e.currentTarget); void run(async () => {
        const startsAt = new Date(String(data.get('startsAt')));
        const endsAt = new Date(String(data.get('endsAt')));
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new Error('Informe datas e horários válidos para o evento.');
        if (endsAt <= startsAt) throw new Error('O fim do evento deve ser posterior ao início.');
        const created = await send('/api/events', 'POST', {
          name: data.get('name'), venue: data.get('venue'), timezone: 'America/Sao_Paulo',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        }); setEvent(created); setGuest(null); setHistory([]); setMessage('Evento de demonstração criado com sucesso.');
      }); }}>
        <label>Nome <input name="name" required minLength={3} defaultValue="Evento teste no navegador" /></label>
        <label>Local <input name="venue" required defaultValue="Ambiente de testes" /></label>
        <label>Início <input name="startsAt" type="datetime-local" required /></label>
        <label>Fim <input name="endsAt" type="datetime-local" required /></label>
        <button disabled={busy}>Criar evento</button>
      </form>
    </section>
    {event && <section><h2>2. Convidar alguém</h2><p>Evento: {event.name} ({event.status})</p>
      <form noValidate onSubmit={e => { e.preventDefault(); const problem = validateForm(e.currentTarget); if (problem) { setMessage(''); setError(problem); return; } const data = new FormData(e.currentTarget); void run(async () => {
        setGuest(await send(`/api/events/${event.id}/guests`, 'POST', { name: data.get('name'), email: data.get('email') }));
        setMessage('Convite gerado com sucesso. Abra o link exibido abaixo.');
      }); }}>
        <label>Nome <input name="name" required minLength={2} defaultValue="Convidado de teste" /></label>
        <label>Email de teste <input name="email" type="email" required placeholder="convidado@example.invalid" /></label>
        <button disabled={busy}>Gerar convite</button>
      </form>
      {guest && <p>Link exclusivo: <a href={guest.invitationUrl} target="_blank" rel="noreferrer">Abrir convite de {guest.name}</a></p>}
      <button disabled={busy || event.status === 'active'} onClick={() => void run(async () => {
        const updated = await send(`/api/events/${event.id}/activate`, 'POST'); setEvent({ ...event, status: updated.status });
        setMessage('Evento ativado com sucesso.');
      })}>Ativar evento</button>
      <p><a href={`http://localhost:3003/?eventId=${event.id}`} target="_blank" rel="noreferrer">Abrir Scanner deste evento</a></p>
      <button disabled={busy} onClick={() => void run(async () => {
        const data = await send(`/api/events/${event.id}/access-events`); setHistory(data.items);
        setMessage('Histórico de acesso atualizado.');
      })}>Atualizar histórico de acesso</button>
      <div className="adminTableWrap"><table className="adminTable"><caption>Histórico de acesso da demonstração</caption><thead><tr><th scope="col">Data e hora</th><th scope="col">Resultado</th><th scope="col">Convidado ou motivo</th></tr></thead><tbody>{history.length ? history.map(item => <tr key={`${item.createdAt}-${item.action}`}><td>{new Date(item.createdAt).toLocaleString('pt-BR')}</td><td><span className={`tableStatus ${item.action === 'denied' ? 'isInactive' : 'isActive'}`}>{item.action === 'entry' ? 'Entrada' : item.action === 'exit' ? 'Saída' : 'Acesso negado'}</span></td><td>{item.guestName ?? (item.action === 'denied' ? accessReasonMessage(item.reason) : 'Convidado')}</td></tr>) : <tr><td colSpan={3} className="tableEmpty">Nenhum acesso registrado até agora.</td></tr>}</tbody></table></div>
    </section>}
    {error && <p role="alert" className="adminError">{error}</p>}
    {message && <p role="status" className="adminSuccess">{message}</p>}
  </main>;
}
