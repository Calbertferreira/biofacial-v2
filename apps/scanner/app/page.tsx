import ScannerPanel from './ScannerPanel';

export default async function ScannerHome({ searchParams }: { searchParams: Promise<{ eventId?: string }> }) {
  const { eventId } = await searchParams;
  return <main><h1>BioFacial Scanner</h1><p>Terminal de acesso para tablet.</p>
    {process.env.BROWSER_DEMO === 'true'
      ? <ScannerPanel eventId={eventId ?? ''} />
      : <p>A leitura facial será habilitada após a integração com o motor biométrico.</p>}
  </main>;
}
