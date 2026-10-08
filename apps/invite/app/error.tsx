'use client';

import { useState } from 'react';

export default function InvitationError({ reset }: { reset: () => void }) {
  const [retrying, setRetrying] = useState(false);
  return <main><section className="card">
    <h1>Não foi possível abrir o convite</h1>
    <p role="alert" className="error">Confira sua conexão e tente novamente. Se o problema continuar, peça ajuda ao organizador.</p>
    <button className="cameraButton" disabled={retrying} onClick={() => { setRetrying(true); reset(); setTimeout(() => setRetrying(false), 2000); }}>{retrying ? 'Tentando novamente...' : 'Tentar novamente'}</button>
  </section></main>;
}
