'use client';

import { useState } from 'react';

type Result = { action: string; reason?: string; guestName?: string };

export default function ScannerPanel({ eventId: initialEventId }: { eventId: string }) {
  const [eventId, setEventId] = useState(initialEventId);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function scan(known: boolean) {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch(`/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, known }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Falha na leitura');
      setResult(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Erro inesperado'); }
    finally { setBusy(false); }
  }
  return <section>
    <p>Modo de demonstração: a leitura usa imagens de teste, sem câmera nem reconhecimento facial real.</p>
    <label>ID do evento <input value={eventId} onChange={e => setEventId(e.target.value)} size={40} /></label><br />
    <button disabled={busy || !eventId} onClick={() => void scan(false)}>Testar pessoa desconhecida</button>{' '}
    <button disabled={busy || !eventId} onClick={() => void scan(true)}>Ler convidado de teste</button>
    {result && <p role="status">{result.action === 'entry' ? `Entrada autorizada: ${result.guestName}` : result.action === 'exit' ? `Saída registrada: ${result.guestName}` : `Acesso negado: ${result.reason}`}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
