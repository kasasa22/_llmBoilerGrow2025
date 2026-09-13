import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Research agent · BOSMART',
  description:
    'Multi-agent research agent — Flask API + Inngest AgentKit Network (Research → Analysis → Synthesis) over self-hosted Ollama.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
