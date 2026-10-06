'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type Event = { id: string; name: string; status: string; startsAt: string; endsAt: string; venue: string };
type Delivery = { id: string; attemptNumber: number; channel: 'email' | 'whatsapp'; status: 'pending' | 'sent' | 'failed'; createdAt: string; error: string | null };
type Guest = { id: string; name: string; email: string | null; phoneE164: string | null; invitationStatus: string; sendAttempts: number; deliveries: Delivery[] };
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
  const [selected, setSelected] = useState<string[]>([]);
  const [showChannels, setShowChannels] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
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
  const selectedGuests = guests.filter(guest => selected.includes(guest.id));
  const canEmail = selectedGuests.every(guest => !!guest.email);
  const canWhatsApp = selectedGuests.every(guest => !!guest.phoneE164);
  const statusLabel: Record<string, string> = { registered: 'Cadastrado', invited: 'Convidado', accepted: 'Convite aceito', attended: 'Compareceu', declined: 'Recusado', expired: 'Expirado' };
  const selectableGuests = guests.filter(guest => !['declined', 'expired'].includes(guest.invitationStatus));
  return <main className="eventDetail"><a href="/admin#eventos">← Voltar aos eventos</a><header><span className="adminEyebrow">OPERAÇÃO DO EVENTO</span><h1>{event?.name ?? 'Carregando evento...'}</h1><p>{event?.venue} · {event?.startsAt && new Date(event.startsAt).toLocaleString('pt-BR')} · Situação: <strong>{event?.status}</strong></p></header>
    {error && <p role="alert" className="adminError">{error}</p>}
    <section className="eventActions"><h2>Operação</h2><button disabled={busy} onClick={() => void action(load)}>Atualizar</button>{event?.status === 'draft' && <button disabled={busy} onClick={() => void action(async () => { await api(`/api/manage/events/${eventId}/activate`, 'POST'); })}>Ativar evento</button>}{event?.status === 'active' && <button disabled={busy} onClick={() => void action(async () => { await api(`/api/manage/events/${eventId}/finish`, 'POST'); })}>Finalizar evento</button>}<p>Scanner: <a href={`${process.env.NEXT_PUBLIC_SCANNER_URL ?? 'http://localhost:3003'}/?eventId=${eventId}`} target="_blank" rel="noreferrer">abrir terminal deste evento ↗</a></p></section>
    <section><h2>Convidar pessoa</h2><form onSubmit={submit => { submit.preventDefault(); const formElement = submit.currentTarget; const form = new FormData(formElement); void action(async () => {
      if (!form.get('email') && !phoneDigits) throw new Error('Informe e-mail ou celular.');
      await api(`/api/manage/events/${eventId}/guests`, 'POST', { name: form.get('name'), email: form.get('email') || undefined, phoneE164: phoneDigits ? `+55${phoneDigits}` : undefined });
      formElement.reset(); setPhoneDigits('');
    }); }}><label>Nome<input name="name" required minLength={2} /></label><label>E-mail<input name="email" type="email" /></label><label>Celular (DDD + número)<input name="phoneDigits" type="text" inputMode="numeric" autoComplete="tel-national" pattern="[0-9]{11}" minLength={11} maxLength={11} placeholder="11987654321" title="Informe 11 dígitos: DDD e celular, sem espaços ou símbolos" value={phoneDigits} onChange={change => setPhoneDigits(change.target.value.replace(/\D/g, '').slice(0, 11))} /></label><button disabled={busy}>Incluir na lista</button></form>
      <h3>Convidados ({guests.length})</h3>
      <div className="guestTableWrap"><table className="guestTable"><thead><tr><th><input type="checkbox" aria-label="Selecionar todos os convidados" checked={selectableGuests.length > 0 && selected.length === selectableGuests.length} onChange={change => setSelected(change.target.checked ? selectableGuests.map(guest => guest.id) : [])} /></th><th>Convidado</th><th>Contato</th><th>Status</th><th>Tentativas</th></tr></thead><tbody>{guests.map(guest => <tr key={guest.id}><td><input type="checkbox" aria-label={`Selecionar ${guest.name}`} disabled={!selectableGuests.includes(guest)} checked={selected.includes(guest.id)} onChange={change => setSelected(current => change.target.checked ? [...current, guest.id] : current.filter(id => id !== guest.id))} /></td><td>{guest.name}</td><td>{guest.email && <div>{guest.email}</div>}{guest.phoneE164 && <div>{guest.phoneE164}</div>}</td><td>{statusLabel[guest.invitationStatus] ?? guest.invitationStatus}</td><td>{guest.sendAttempts}{guest.deliveries.length > 0 && <details><summary>Histórico</summary><ul>{guest.deliveries.map(delivery => <li key={delivery.id}>#{delivery.attemptNumber} · {delivery.channel === 'email' ? 'E-mail' : 'WhatsApp'} · {delivery.status === 'sent' ? 'Enviado' : delivery.status === 'pending' ? 'Processando' : `Falhou (${delivery.error ?? 'erro'})`} · {new Date(delivery.createdAt).toLocaleString('pt-BR')}</li>)}</ul></details>}</td></tr>)}</tbody></table></div>
      <button type="button" disabled={busy || selected.length === 0} onClick={() => { setShowChannels(true); setSendResult(''); }}>Gerar convite / enviar selecionados ({selected.length})</button>
      {showChannels && <div className="eventSendPanel" role="dialog" aria-label="Escolher canais de envio"><h4>Enviar para {selected.length} convidado(s)</h4><p>Escolha WhatsApp, e-mail ou ambos. Reenvios criam uma nova tentativa.</p><label><input type="checkbox" checked={sendWhatsApp} disabled={!canWhatsApp} onChange={change => setSendWhatsApp(change.target.checked)} /> WhatsApp {!canWhatsApp && '(há convidados sem celular)'}</label><label><input type="checkbox" checked={sendEmail} disabled={!canEmail} onChange={change => setSendEmail(change.target.checked)} /> E-mail {!canEmail && '(há convidados sem e-mail)'}</label><div><button type="button" disabled={busy || (!sendEmail && !sendWhatsApp) || (sendEmail && !canEmail) || (sendWhatsApp && !canWhatsApp)} onClick={() => void action(async () => { const result = await api(`/api/manage/events/${eventId}/invitations/send`, 'POST', { guestIds: selected, channels: [...(sendWhatsApp ? ['whatsapp'] : []), ...(sendEmail ? ['email'] : [])] }); const sent = result.items.filter((item: {status: string}) => item.status === 'sent').length; const failed = result.items.length - sent; setSendResult(`${sent} envio(s) aceito(s) pelo provedor; ${failed} falha(s).`); setShowChannels(false); setSelected([]); })}>Enviar convites</button><button type="button" className="secondary" onClick={() => setShowChannels(false)}>Cancelar</button></div></div>}
      {sendResult && <p role="status">{sendResult}</p>}
    </section><section><h2>Histórico de acesso</h2><p>{access.filter(item => item.action === 'entry').length} entradas · {access.filter(item => item.action === 'exit').length} saídas · {access.filter(item => item.action === 'denied').length} tentativas negadas</p><ul>{access.slice().reverse().map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleString('pt-BR')} · {item.action === 'entry' ? 'Entrada' : item.action === 'exit' ? 'Saída' : 'Negado'} · {item.guestName ?? item.reason ?? 'desconhecido'}</li>)}</ul></section>
  </main>;
}
