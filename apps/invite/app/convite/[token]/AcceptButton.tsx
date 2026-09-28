'use client';

import { useState } from 'react';

export default function AcceptButton({ token, initialStatus }: { token: string; initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (status === 'accepted') return <p role="status">Situação do convite: Aceito. Cadastro facial de teste confirmado.</p>;
  return <section>
    <p>Situação do convite: Pendente.</p>
    <p>Modo de demonstração: a captura facial será substituída por uma imagem de teste. Nenhuma foto sua é coletada.</p>
    <button disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const response = await fetch(`/api/invitations/${token}/accept`, { method: 'POST' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Falha ao aceitar convite');
        setStatus(body.status);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha inesperada'); }
      finally { setBusy(false); }
    }}>Aceitar convite com rosto de teste</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
