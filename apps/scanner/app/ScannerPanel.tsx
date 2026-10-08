'use client';
import { useEffect, useRef, useState } from 'react';

type Event = { id: string; name: string; status: string; startsAt: string; endsAt: string; timezone: string };
type User = { name: string; mustChangePassword?: boolean };
type Result = { action: 'entry' | 'exit' | 'denied'; reason?: string; guestName?: string };

function formatEventTime(value: string, timezone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'horário informado pelo organizador';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: timezone || 'America/Sao_Paulo' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short' }).format(date);
  }
}

const errorMessages: Record<string, string> = {
  unauthorized: 'Sua sessão terminou. Entre novamente para usar o scanner.',
  invalid_credentials: 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
  temporarily_locked: 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.',
  password_change_required: 'Altere sua senha temporária no painel antes de usar o scanner.',
  invalid_input: 'Os dados enviados não são válidos. Atualize a página e tente novamente.',
  event_not_found: 'Este evento não foi encontrado. Selecione outro evento.',
  event_not_active: 'Este evento não está disponível para registrar entradas. Consulte o organizador.',
  event_ended: 'O período deste evento já terminou. Não é mais possível registrar entradas.',
  face_not_found: 'Não detectamos um rosto. Olhe de frente para a câmera e tente novamente.',
  multiple_faces: 'A câmera detectou mais de um rosto. Fique sozinho diante dela e tente novamente.',
  face_too_small: 'Aproxime o rosto da câmera e tente novamente.',
  invalid_image: 'Não foi possível analisar a imagem. Tente capturar novamente.',
  face_engine_unavailable: 'O reconhecimento facial está indisponível no momento. Tente novamente em instantes.',
};

async function json<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, options); }
  catch { throw new Error('Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.'); }
  let body: Record<string, unknown>;
  try { body = await response.json(); }
  catch { throw new Error('O servidor respondeu de forma inesperada. Tente novamente em instantes.'); }
  if (!response.ok) {
    if (body.error === 'event_not_started') {
      const start = typeof body.startsAt === 'string' ? ` O registro será liberado em ${formatEventTime(body.startsAt, typeof body.timezone === 'string' ? body.timezone : undefined)}.` : '';
      throw new Error(`Ainda não chegou o dia e horário marcados para este evento.${start}`);
    }
    throw new Error(typeof body.error === 'string' ? errorMessages[body.error] ?? 'Não foi possível concluir a operação. Tente novamente ou procure o organizador.' : 'Não foi possível concluir a operação. Tente novamente.');
  }
  return body as T;
}

function resultMessage(result: Result): string {
  if (result.reason === 'already_inside') return `${result.guestName ?? 'Este convidado'} já entrou no evento.`;
  if (result.reason === 'not_inside') return `${result.guestName ?? 'Este convidado'} ainda não registrou entrada.`;
  if (result.reason === 'no_match') return 'Não encontramos este rosto entre os convidados do evento.';
  if (result.reason === 'review') return 'A identificação não foi conclusiva. Confira o convite com o organizador.';
  if (result.reason === 'guest_not_eligible') return 'O rosto foi identificado, mas o convite não está aceito para este evento.';
  return result.guestName ?? 'Acesso negado. Confira o convite com o organizador.';
}

export default function ScannerPanel({ initialEventId }: { initialEventId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState(initialEventId);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const selectedEvent = events.find(item => item.id === eventId);

  useEffect(() => { void (async () => {
    try { const current = await json<User>('/api/session/me'); setUser(current); setEvents((await json<{ items: Event[] }>('/api/events')).items); }
    catch (cause) {
      setUser(null);
      if (cause instanceof Error && cause.message !== 'Sua sessão terminou. Entre novamente para usar o scanner.') setError(cause.message);
    }
  })(); return () => { stream.current?.getTracks().forEach(track => track.stop()); }; }, []);

  async function startCamera() {
    setError(''); setMessage('');
    try {
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play(); }
      setCameraReady(true);
      setMessage('Câmera pronta. Posicione o rosto do convidado e escolha entrada ou saída.');
    } catch { setError('Não foi possível abrir a câmera. Permita o acesso à câmera neste navegador.'); }
  }

  async function scan(direction: 'entry' | 'exit') {
    if (!video.current || !eventId) return;
    setBusy(true); setError(''); setMessage(''); setResult(null);
    try {
      const canvas = document.createElement('canvas');
      if (!video.current.videoWidth || !video.current.videoHeight) throw new Error('Aguarde a câmera carregar e tente novamente.');
      const width = Math.min(1280, video.current.videoWidth);
      canvas.width = width; canvas.height = Math.round(video.current.videoHeight * width / video.current.videoWidth);
      canvas.getContext('2d')?.drawImage(video.current, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL('image/jpeg', .82).split(',')[1];
      setResult(await json<Result>('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, imageBase64, direction }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível identificar o rosto. Tente novamente.'); }
    finally { setBusy(false); }
  }

  if (!user) return <section className="panel"><h2>Acesso do operador</h2><p>Entre com uma conta autorizada para operar o scanner.</p><form noValidate onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const email = String(form.get('email') ?? '').trim(); const password = String(form.get('password') ?? '');
    if (!email) { setError('Informe seu e-mail.'); return; }
    if (!(event.currentTarget.elements.namedItem('email') as HTMLInputElement).checkValidity()) { setError('Informe um e-mail válido.'); return; }
    if (!password) { setError('Informe sua senha.'); return; }
    setBusy(true); setError(''); setMessage('');
    void json<{ user: User }>('/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })
      .then(async value => { setUser(value.user); setEvents((await json<{ items: Event[] }>('/api/events')).items); setMessage('Acesso autorizado. Selecione o evento e abra a câmera.'); })
      .catch(cause => setError(cause.message)).finally(() => setBusy(false));
  }}><label>E-mail<input name="email" type="email" required autoComplete="username" /></label><label>Senha<input name="password" type="password" required autoComplete="current-password" /></label><button disabled={busy}>{busy ? 'Entrando...' : 'Entrar'}</button></form>{message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}</section>;

  if (user.mustChangePassword) return <section className="panel"><p>Altere sua senha no Manager antes de operar o scanner.</p></section>;
  return <section className="panel"><div className="toolbar"><span>Operador: {user.name}</span><button className="secondary" disabled={busy} onClick={async () => { try { await json('/api/session/logout', { method: 'POST' }); setUser(null); stream.current?.getTracks().forEach(track => track.stop()); setCameraReady(false); setMessage('Você saiu do scanner com segurança.'); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível sair. Tente novamente.'); } }}>Sair</button></div>
    <label>Evento ativo<select value={eventId} onChange={event => { setEventId(event.target.value); setResult(null); setError(''); }}><option value="">Selecione um evento</option>{events.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {selectedEvent && <p className="eventSchedule">Entradas e saídas disponíveis de {formatEventTime(selectedEvent.startsAt, selectedEvent.timezone)} até {formatEventTime(selectedEvent.endsAt, selectedEvent.timezone)}.</p>}
    <div className="camera"><video ref={video} playsInline muted autoPlay /></div>
    {!cameraReady ? <button onClick={() => void startCamera()}>Abrir câmera</button> : <div className="scanButtons"><button disabled={busy || !eventId} onClick={() => void scan('entry')}>{busy ? 'Identificando...' : 'Registrar entrada'}</button><button disabled={busy || !eventId} onClick={() => void scan('exit')}>{busy ? 'Identificando...' : 'Registrar saída'}</button></div>}
    {result && <div className={`result ${result.action}`} role="status"><strong>{result.action === 'entry' ? 'ENTRADA AUTORIZADA' : result.action === 'exit' ? 'SAÍDA REGISTRADA' : 'ACESSO NEGADO'}</strong><p>{resultMessage(result)}</p></div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
