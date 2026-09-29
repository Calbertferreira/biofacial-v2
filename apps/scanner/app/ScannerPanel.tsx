'use client';
import { useEffect, useRef, useState } from 'react';

type Event = { id: string; name: string; status: string; startsAt: string };
type User = { name: string; mustChangePassword?: boolean };
type Result = { action: 'entry' | 'exit' | 'denied'; reason?: string; guestName?: string };

async function json(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export default function ScannerPanel({ initialEventId }: { initialEventId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState(initialEventId);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => { void (async () => {
    try { const current = await json('/api/session/me'); setUser(current); setEvents((await json('/api/events')).items); }
    catch { setUser(null); }
  })(); return () => { stream.current?.getTracks().forEach(track => track.stop()); }; }, []);

  async function startCamera() {
    setError('');
    try {
      stream.current?.getTracks().forEach(track => track.stop());
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (video.current) { video.current.srcObject = stream.current; await video.current.play(); }
      setCameraReady(true);
    } catch { setError('Não foi possível abrir a câmera. Permita o acesso à câmera neste navegador.'); }
  }

  async function scan(direction: 'entry' | 'exit') {
    if (!video.current || !eventId) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const canvas = document.createElement('canvas');
      if (!video.current.videoWidth || !video.current.videoHeight) throw new Error('Aguarde a câmera carregar e tente novamente.');
      const width = Math.min(1280, video.current.videoWidth);
      canvas.width = width; canvas.height = Math.round(video.current.videoHeight * width / video.current.videoWidth);
      canvas.getContext('2d')?.drawImage(video.current, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL('image/jpeg', .82).split(',')[1];
      setResult(await json('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, imageBase64, direction }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro inesperado'); }
    finally { setBusy(false); }
  }

  if (!user) return <section className="panel"><h2>Acesso do operador</h2><p>Entre com uma conta autorizada para operar o scanner.</p><form onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError('');
    void json('/api/session/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })
      .then(async value => { setUser(value.user); setEvents((await json('/api/events')).items); })
      .catch(cause => setError(cause.message)).finally(() => setBusy(false));
  }}><label>E-mail<input name="email" type="email" required autoComplete="username" /></label><label>Senha<input name="password" type="password" required autoComplete="current-password" /></label><button disabled={busy}>Entrar</button></form>{error && <p role="alert" className="error">{error}</p>}</section>;

  if (user.mustChangePassword) return <section className="panel"><p>Altere sua senha no Manager antes de operar o scanner.</p></section>;
  return <section className="panel"><div className="toolbar"><span>Operador: {user.name}</span><button className="secondary" onClick={async () => { await json('/api/session/logout', { method: 'POST' }); setUser(null); stream.current?.getTracks().forEach(track => track.stop()); setCameraReady(false); }}>Sair</button></div>
    <label>Evento ativo<select value={eventId} onChange={event => { setEventId(event.target.value); setResult(null); }}><option value="">Selecione um evento</option>{events.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="camera"><video ref={video} playsInline muted autoPlay /></div>
    {!cameraReady ? <button onClick={() => void startCamera()}>Abrir câmera</button> : <div className="scanButtons"><button disabled={busy || !eventId} onClick={() => void scan('entry')}>{busy ? 'Identificando...' : 'Registrar entrada'}</button><button disabled={busy || !eventId} onClick={() => void scan('exit')}>{busy ? 'Identificando...' : 'Registrar saída'}</button></div>}
    {result && <div className={`result ${result.action}`} role="status"><strong>{result.action === 'entry' ? 'ENTRADA AUTORIZADA' : result.action === 'exit' ? 'SAÍDA REGISTRADA' : 'ACESSO NEGADO'}</strong><p>{result.reason === 'already_inside' ? `${result.guestName} já está dentro do evento.` : result.reason === 'not_inside' ? `${result.guestName} ainda não entrou no evento.` : result.guestName ?? (result.reason === 'no_match' ? 'Rosto não encontrado na lista de convidados.' : result.reason === 'review' ? 'Identificação inconclusiva. Confira o convite manualmente.' : result.reason)}</p></div>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
