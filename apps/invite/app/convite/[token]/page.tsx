import { notFound } from 'next/navigation';
import AcceptButton from './AcceptButton';

type Invitation = { guestName: string; invitationStatus: string; hasStoredImage: boolean; eventName: string; startsAt: string; endsAt: string; timezone: string; venue: string };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const base = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const response = await fetch(`${base}/v1/invitations/${token}`, { cache: 'no-store' });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Não foi possível consultar o convite.');
  const invitation = await response.json() as Invitation;
  return <main><header><span className="eyebrow">ALLTICKET · CONVITE INDIVIDUAL</span><h1>{invitation.eventName}</h1><p>Olá, {invitation.guestName}. Seu lugar está reservado.</p></header>
    <div className="details"><div><small>LOCAL</small><strong>{invitation.venue}</strong></div><div><small>DATA E HORA</small><strong>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short', timeZone: invitation.timezone }).format(new Date(invitation.startsAt))}</strong></div></div>
    <AcceptButton token={token} initialStatus={invitation.invitationStatus} hasStoredImage={invitation.hasStoredImage} />
  </main>;
}
