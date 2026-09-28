import { notFound } from 'next/navigation';
import AcceptButton from './AcceptButton';

type Invitation = { guestName: string; invitationStatus: string; eventName: string; startsAt: string; endsAt: string; timezone: string; venue: string };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const base = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const response = await fetch(`${base}/v1/invitations/${token}`, { cache: 'no-store' });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Não foi possível consultar o convite.');
  const invitation = await response.json() as Invitation;
  return <main>
    <h1>{invitation.eventName}</h1>
    <p>Olá, {invitation.guestName}.</p>
    <p>Local: {invitation.venue}</p>
    <p>Início: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: invitation.timezone }).format(new Date(invitation.startsAt))}</p>
    {process.env.BROWSER_DEMO === 'true'
      ? <AcceptButton token={token} initialStatus={invitation.invitationStatus} />
      : <><p>Situação do convite: {invitation.invitationStatus === 'pending' ? 'Pendente' : invitation.invitationStatus}</p><p>O cadastro facial pelo celular será liberado após a integração biométrica.</p></>}
  </main>;
}
