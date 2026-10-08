'use client';

import { useState } from 'react';

export default function ManagerError({ reset }: { reset: () => void }) {
  const [retrying, setRetrying] = useState(false);
  return <main className="adminAuth"><div className="adminAuthRight"><div className="adminAuthCard">
    <h1>Não foi possível carregar esta tela</h1>
    <p role="alert" className="adminError">O serviço pode estar temporariamente indisponível. Confira sua conexão e tente novamente.</p>
    <button className="adminPrimary" disabled={retrying} onClick={() => { setRetrying(true); reset(); setTimeout(() => setRetrying(false), 2000); }}>{retrying ? 'Tentando novamente...' : 'Tentar novamente'}</button>
  </div></div></main>;
}
