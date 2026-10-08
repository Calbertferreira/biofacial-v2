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
  face_profile_event_mismatch: 'Seu cadastro facial está vinculado de forma incorreta. Procure o organizador deste evento.',
  invitation_unavailable: 'Este convite não está mais disponível.',
  invitation_not_found: 'Este link de convite não foi encontrado. Peça um novo link ao organizador.',
  invalid_input: 'Não foi possível validar os dados do convite. Atualize a página e tente novamente.',
};

export default function AcceptButton({ token, initialStatus, hasStoredImage }: { token: string; initialStatus: string; hasStoredImage: boolean }) {
  const [status, setStatus] = useState(initialStatus);
  const [storedImage, setStoredImage] = useState(hasStoredImage);
  const [image, setImage] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [openingCamera, setOpeningCamera] = useState(false);
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
    void videoRef.current.play().catch(() => {
      stopCamera();
      setError('Não foi possível iniciar a câmera frontal. Abra o link no Chrome e tente novamente.');
    });
  }, [cameraOpen]);

  async function openFrontCamera() {
    setError(''); setMessage(''); setOpeningCamera(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador não permite abrir a câmera frontal. Abra o link no Chrome e tente novamente.');
      setOpeningCamera(false);
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
      setMessage('Câmera frontal aberta. Posicione seu rosto e toque em “Usar esta selfie”.');
    } catch {
      setError('Não foi possível abrir a câmera frontal. Permita o acesso à câmera e tente novamente no Chrome.');
    } finally {
      setOpeningCamera(false);
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
    setMessage('Selfie capturada. Confira a imagem, marque a autorização e aceite o convite.');
    stopCamera();
  }
  if (status === 'attended') return <div className="success" role="status"><h2>Presença registrada</h2><p>Sua entrada no evento foi registrada.</p></div>;
  if (status === 'accepted' && storedImage) return <div className="success" role="status"><h2>Presença confirmada</h2><p>Seu convite está aceito. Sua selfie está salva para este evento. Apresente seu rosto na entrada.</p></div>;
  if (status !== 'registered' && status !== 'invited' && status !== 'accepted') return <p role="alert" className="error">Este convite não está disponível.</p>;

  return <section className="card">
    <h2>{status === 'accepted' ? 'Atualize sua selfie para este evento' : 'Confirme sua presença'}</h2>
    <p>{status === 'accepted' ? 'Seu convite já foi aceito, mas a selfie não ficou salva. Tire uma nova selfie para concluir seu cadastro facial neste evento.' : 'Use a câmera frontal e mantenha o telefone a uma distância em que seu rosto inteiro e os ombros apareçam. Apenas você deve estar na imagem.'}</p>
    <div className="cameraControls"><button type="button" className="cameraButton" disabled={busy || cameraOpen || openingCamera} onClick={() => void openFrontCamera()}>{openingCamera ? 'Abrindo câmera...' : image ? 'Tirar outra selfie' : 'Abrir câmera frontal'}</button></div>{cameraOpen && <div className="cameraCapture"><video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setCameraReady(true)} /><div className="cameraControls"><button type="button" className="cameraButton" disabled={!cameraReady} onClick={captureFrontCamera}>Usar esta selfie</button><button type="button" className="cameraButton secondary" onClick={() => { stopCamera(); setMessage('Captura cancelada. Abra a câmera frontal quando estiver pronto.'); }}>Cancelar</button></div></div>}
    {image && <img className="preview" src={`data:image/jpeg;base64,${image}`} alt="Prévia da foto capturada" />}
    <label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> Autorizo o armazenamento cifrado da minha selfie e do modelo facial para identificação somente neste evento.</label>
    {!consent && <p>Marque a autorização acima para liberar o aceite do convite.</p>}
    {!image && <p>Tire uma selfie com a câmera frontal para continuar.</p>}
    <button className="primary" disabled={busy || !consent || !image} onClick={async () => {
      setBusy(true); setError(''); setMessage('');
      try {
        let response: Response;
        try {
          response = await fetch(`/api/invitations/${token}/accept`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ consent: true, imageBase64: image }),
          });
        } catch {
          throw new Error('Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.');
        }
        let body: { error?: string; status?: string };
        try { body = await response.json(); }
        catch { throw new Error('O servidor respondeu de forma inesperada. Tente novamente em instantes.'); }
        if (!response.ok) throw new Error(body.error ? messages[body.error] ?? 'Não foi possível aceitar o convite. Tente novamente ou procure o organizador.' : 'Não foi possível aceitar o convite. Tente novamente.');
        if (body.status !== 'accepted') throw new Error('O servidor não confirmou o aceite do convite. Tente novamente.');
        setStoredImage(true);
        setStatus(body.status);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha inesperada'); }
      finally { setBusy(false); }
    }}>{busy ? 'Confirmando...' : status === 'accepted' ? 'Salvar selfie deste evento' : 'Aceitar convite'}</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
