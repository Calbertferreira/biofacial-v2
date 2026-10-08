'use client';
import { useEffect, useRef, useState } from 'react';

const messages: Record<string, string> = {
  face_capture_required: 'Tire uma foto para concluir o cadastro.',
  invalid_image: 'A imagem não pôde ser processada. Tire outra foto.',
  face_too_small: 'Aproxime o rosto da câmera e tente novamente.',
  image_too_small: 'A foto está pequena. Tire outra com melhor resolução.',
  face_not_found: 'Não detectamos um rosto na foto. Olhe de frente para a câmera, sem cobrir o rosto, e tente novamente.',
  multiple_faces: 'Detectamos mais de um rosto. Tire a foto sozinho, sem pessoas ou retratos ao fundo.',
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);

  function stopCamera() {
    cameraRequestRef.current += 1;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
    setCameraReady(false);
  }

  useEffect(() => () => {
    cameraRequestRef.current += 1;
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setError('Não foi possível iniciar a câmera frontal. Escolha uma foto do aparelho.'));
  }, [cameraOpen]);

  async function openFrontCamera() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador não permite abrir a câmera frontal. Abra o link no Chrome ou escolha uma foto do aparelho.');
      return;
    }
    setImage(null);
    const requestId = ++cameraRequestRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: 'user' } } });
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      setCameraReady(false);
      setCameraOpen(true);
    } catch {
      setError('Não foi possível abrir a câmera frontal. Permita o acesso, abra o link no Chrome ou escolha uma foto do aparelho.');
    }
  }

  function captureFrontCamera() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError('A câmera ainda não está pronta. Tente novamente.');
      return;
    }
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      setError('Não foi possível capturar a foto.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setImage(canvas.toDataURL('image/jpeg', 0.84).split(',')[1]);
    setError('');
    stopCamera();
  }
  if (status === 'attended') return <div className="success" role="status"><h2>Presença registrada</h2><p>Sua entrada no evento foi registrada.</p></div>;
  if (status === 'accepted') return <div className="success" role="status"><h2>Presença confirmada</h2><p>Seu convite está aceito. Apresente seu rosto na entrada do evento.</p></div>;
  if (status !== 'registered' && status !== 'invited') return <p>Este convite não está disponível.</p>;

  return <section className="card">
    <h2>Confirme sua presença</h2>
    <p>{hasFaceProfile ? 'Seu cadastro facial anterior será utilizado. Confirme para aceitar o convite.' : 'Use a câmera frontal e mantenha o telefone a uma distância em que seu rosto inteiro e os ombros apareçam. Apenas você deve estar na imagem.'}</p>
    {!hasFaceProfile && <><div className="cameraControls"><button type="button" className="cameraButton" disabled={busy || cameraOpen} onClick={() => void openFrontCamera()}>Abrir câmera frontal</button><label className="cameraButton secondary">Escolher foto<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try { stopCamera(); setImage(await prepareImage(file)); setError(''); }
      catch { setError('Não foi possível abrir a foto.'); }
      event.target.value = '';
    }} /></label></div>{cameraOpen && <div className="cameraCapture"><video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setCameraReady(true)} /><div className="cameraControls"><button type="button" className="cameraButton" disabled={!cameraReady} onClick={captureFrontCamera}>Usar esta foto</button><button type="button" className="cameraButton secondary" onClick={stopCamera}>Cancelar</button></div></div>}</>}
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
