import ScannerPanel from './ScannerPanel';

export default async function ScannerHome({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId } = await searchParams;
  return <main><header><small>ALLTICKET · SCANNER</small><h1>Controle de acesso</h1><p>Identifique convidados e registre entradas e saídas.</p></header><ScannerPanel initialEventId={eventId ?? ''} /></main>;
}
