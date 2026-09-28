import type { ReactNode } from 'react';
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body style={{ fontFamily: 'system-ui', maxWidth: 600, margin: '3rem auto', padding: '0 1rem' }}>{children}</body></html>;
}
