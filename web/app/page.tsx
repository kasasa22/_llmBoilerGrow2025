import { ChatPanel } from '@/components/ChatPanel';
import { readEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function Home() {
  const env = readEnv();

  return (
    <>
      <header>
        <div className="brand">
          <span className="logo">◇</span>
          <h1>Research agent</h1>
          <span className="badge" title="Model in use">
            {env.modelName}
          </span>
          <span className={`badge env-${env.env}`}>{env.env}</span>
        </div>
        <div className="brand-right">
          <a
            href="https://github.com/kasasa22/_llmBoilerGrow2025"
            target="_blank"
            rel="noopener noreferrer"
          >
            source
          </a>
        </div>
      </header>

      <ChatPanel modelName={env.modelName} env={env.env} />

      <footer>
        <span>Civo GPU · Inngest AgentKit · Ollama · SSE · Next.js</span>
      </footer>
    </>
  );
}
