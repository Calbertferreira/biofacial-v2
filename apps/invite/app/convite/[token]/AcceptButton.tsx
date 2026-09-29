'use client';
import { useState } from 'react';

const messages: Record<string, string> = {
  face_capture_required: 'Tire uma foto para concluir o cadastro.',
  invalid_image: 'A imagem não pôde ser processada. Tire outra foto.',
  face_too_small: 'Aproxime o rosto da câmera e tente novamente.',
  image_too_small: 'A foto está pequena. Tire outra com melhor resolução.',
  exactly_one_face_required: 'A foto deve mostrar apenas um rosto, bem iluminado.',
  face_engine_unavailable: 'O reconhecimento está indisponível. Tente novamente em instantes.',
  invitation_unavailable: 'Este convite não está mais disponível.',
};

async function prepareImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.84).split(',')[1];
}

export default function AcceptButton({ token, initialStatus, hasFaceProfile }: { token: string; initialStatus: string; hasFaceProfile: boolean }) {
  const [status, setStatus] = useState(initialStatus);
  const [image, setImage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (status === 'accepted') return <div className="success" role="status"><h2>Presença confirmada</h2><p>Seu convite está aceito. Apresente seu rosto na entrada do evento.</p></div>;
  if (status !== 'pending') return <p>Este convite não está disponível.</p>;

  return <section className="card">
    <h2>Confirme sua presença</h2>
    <p>{hasFaceProfile ? 'Seu cadastro facial anterior será utilizado. Confirme para aceitar o convite.' : 'Tire uma foto nítida do seu rosto para aceitar o convite. Apenas você deve aparecer na imagem.'}</p>
    {!hasFaceProfile && <label className="cameraButton">{image ? 'Trocar foto' : 'Abrir câmera'}<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try { setImage(await prepareImage(file)); setError(''); }
      catch { setError('Não foi possível abrir a foto.'); }
    }} /></label>}
    {image && !hasFaceProfile && <img className="preview" src={`data:image/jpeg;base64,${image}`} alt="Prévia da foto capturada" />}
    <label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> Autorizo o uso da minha biometria facial para identificação neste evento. A foto é processada para gerar um modelo biométrico; a foto não é armazenada.</label>
    <button className="primary" disabled={busy || !consent || (!hasFaceProfile && !image)} onClick={async () => {
      setBusy(true); setError('');
      try {
        const response = await fetch(`/api/invitations/${token}/accept`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ consent: true, ...(hasFaceProfile ? {} : { imageBase64: image }) }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(messages[body.error] ?? body.error ?? 'Falha ao aceitar convite');
        setStatus(body.status);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha inesperada'); }
      finally { setBusy(false); }
    }}>{busy ? 'Confirmando...' : 'Aceitar convite'}</button>
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
