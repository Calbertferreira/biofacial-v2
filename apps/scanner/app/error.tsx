'use client';

import { useState } from 'react';

export default function ScannerError({ reset }: { reset: () => void }) {
  const [retrying, setRetrying] = useState(false);
  return <main><section className="panel">
    <h1>Não foi possível carregar o scanner</h1>
    <p role="alert" className="error">Confira sua conexão e tente novamente. Se o problema continuar, procure o organizador.</p>
    <button disabled={retrying} onClick={() => { setRetrying(true); reset(); setTimeout(() => setRetrying(false), 2000); }}>{retrying ? 'Tentando novamente...' : 'Tentar novamente'}</button>
  </section></main>;
}
