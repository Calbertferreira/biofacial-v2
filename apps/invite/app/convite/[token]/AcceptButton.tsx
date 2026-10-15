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
  face_mismatch: 'A selfie não é compatível com a foto do nosso cadastro. Posicione o rosto de frente para a câmera e tente capturar outra foto.',
  face_review_required: 'A comparação facial não foi conclusiva. Tire outra selfie de frente para a câmera, com boa iluminação. Se o problema continuar, procure o organizador.',
  identity_conflict: 'O e-mail e o telefone deste convite estão vinculados a cadastros diferentes. Procure o organizador para corrigir os dados.',
  face_model_mismatch: 'Não foi possível comparar a foto com o cadastro existente. Procure o organizador.',
  face_already_registered_for_event: 'Este rosto já confirmou outro convite para o mesmo evento. Procure o organizador para corrigir a lista.',
  invitation_unavailable: 'Este convite não está mais disponível.',
  invitation_not_found: 'Este link de convite não foi encontrado. Peça um novo link ao organizador.',
  invalid_input: 'Não foi possível validar os dados do convite. Atualize a página e tente novamente.',
};

export default function AcceptButton({ token, initialStatus, eventStatus, hasStoredImage }: { token: string; initialStatus: string; eventStatus: string; hasStoredImage: boolean }) {
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
  const [faceMismatch, setFaceMismatch] = useState(false);
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
    setError(''); setMessage(''); setFaceMismatch(false); setOpeningCamera(true);
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

  useEffect(() => {
    if (!hasStoredImage && !['finished', 'cancelled'].includes(eventStatus)
      && ['registered', 'invited', 'accepted', 'reconfirmation_pending', 'declined'].includes(initialStatus)) {
      void openFrontCamera();
    }
    // A câmera deve ser solicitada uma vez quando o convite é aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  if (eventStatus === 'cancelled') return <p role="alert" className="error">Este evento foi cancelado. O convite não está mais disponível.</p>;
  if (eventStatus === 'finished') return <p role="alert" className="error">Este evento foi finalizado. O convite não está mais disponível.</p>;
  if (status === 'attended') return <div className="success" role="status"><h2>Presença registrada</h2><p>Sua entrada no evento foi registrada.</p></div>;
  if (status === 'accepted' && storedImage) return <div className="success" role="status"><h2>Presença confirmada</h2><p>Seu convite está aceito. Seu cadastro facial foi confirmado para este evento. Apresente seu rosto na entrada.</p></div>;
  if (!['registered', 'invited', 'accepted', 'reconfirmation_pending', 'declined'].includes(status)) return <p role="alert" className="error">Este convite não está disponível.</p>;

  return <section className="card">
    {faceMismatch && <div className="faceMismatchScreen" aria-hidden="true" />}
    <h2>{status === 'reconfirmation_pending' ? 'Confirme os novos dados do evento' : status === 'declined' ? 'Você informou que não poderá comparecer' : storedImage ? 'Confirme sua presença' : status === 'accepted' ? 'Conclua seu cadastro facial' : 'Confirme sua presença'}</h2>
    <p>{status === 'reconfirmation_pending' ? 'A data, o horário ou o local mudou desde seu último aceite. A confirmação anterior não autoriza sua entrada. Confira os dados acima e responda novamente; sua foto cadastrada será mantida.' : status === 'declined' ? 'Se seus planos mudaram, você pode confirmar sua presença enquanto o evento estiver aberto.' : storedImage ? 'Seu cadastro facial já existe. Aceite o convite para participar deste evento; não é preciso tirar outra selfie.' : status === 'accepted' ? 'Seu convite já foi aceito, mas ainda falta cadastrar seu rosto. Tire uma selfie para concluir o cadastro.' : 'Para seu primeiro cadastro facial, a câmera frontal será aberta. Mantenha o rosto inteiro e os ombros visíveis. Apenas você deve estar na imagem.'}</p>
    {!storedImage && <div className="cameraControls"><button type="button" className="cameraButton" disabled={busy || cameraOpen || openingCamera} onClick={() => void openFrontCamera()}>{openingCamera ? 'Abrindo câmera...' : faceMismatch ? 'Tentar outra selfie' : image ? 'Tirar outra selfie' : 'Abrir câmera frontal'}</button></div>}{!storedImage && cameraOpen && <div className="cameraCapture"><video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setCameraReady(true)} /><div className="cameraControls"><button type="button" className="cameraButton" disabled={!cameraReady} onClick={captureFrontCamera}>Usar esta selfie</button><button type="button" className="cameraButton secondary" onClick={() => { stopCamera(); setMessage('Captura cancelada. Abra a câmera frontal quando estiver pronto.'); }}>Cancelar</button></div></div>}
    {image && <img className="preview" src={`data:image/jpeg;base64,${image}`} alt="Prévia da foto capturada" />}
    <label className="consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> {storedImage ? 'Aceito este convite e autorizo o uso do meu cadastro facial existente para identificar minha entrada neste evento.' : 'Aceito este convite e autorizo o armazenamento cifrado de uma foto e do modelo facial vinculados ao meu e-mail e telefone para identificar minha entrada nos eventos cujos convites eu aceitar.'}</label>
    {!consent && <p>Marque a autorização acima para liberar o aceite do convite.</p>}
    {!storedImage && !image && <p>Tire uma selfie com a câmera frontal para continuar.</p>}
    <button className="primary" disabled={busy || !consent || (!storedImage && !image)} onClick={async () => {
      setBusy(true); setError(''); setMessage('');
      try {
        let response: Response;
        try {
          response = await fetch(`/api/invitations/${token}/accept`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ consent: true, ...(!storedImage && image ? { imageBase64: image } : {}) }),
          });
        } catch {
          throw new Error('Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.');
        }
        let body: { error?: string; status?: string };
        try { body = await response.json(); }
        catch { throw new Error('O servidor respondeu de forma inesperada. Tente novamente em instantes.'); }
        if (!response.ok) {
          if (body.error === 'face_mismatch') { setFaceMismatch(true); setImage(null); }
          throw new Error(body.error ? messages[body.error] ?? 'Não foi possível aceitar o convite. Tente novamente ou procure o organizador.' : 'Não foi possível aceitar o convite. Tente novamente.');
        }
        if (body.status !== 'accepted') throw new Error('O servidor não confirmou o aceite do convite. Tente novamente.');
        setStoredImage(true);
        setStatus(body.status);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha inesperada'); }
      finally { setBusy(false); }
    }}>{busy ? 'Confirmando...' : status === 'reconfirmation_pending' ? 'Confirmar nova data e local' : status === 'accepted' ? 'Confirmar cadastro facial' : 'Aceitar convite'}</button>
    {status !== 'declined' && <button type="button" className="cameraButton secondary" disabled={busy} onClick={async () => {
      setBusy(true); setError(''); setMessage(''); stopCamera();
      try {
        const response = await fetch(`/api/invitations/${token}/decline`, { method: 'POST' });
        const body = await response.json() as { error?: string; status?: string };
        if (!response.ok || body.status !== 'declined') throw new Error(body.error ? messages[body.error] ?? 'Não foi possível registrar sua resposta.' : 'Não foi possível registrar sua resposta.');
        setStatus('declined'); setConsent(false); setImage(null);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha inesperada'); }
      finally { setBusy(false); }
    }}>Não poderei comparecer</button>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
