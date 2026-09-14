import { ChatPanel } from '@/components/ChatPanel';
import { readEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function Home() {
  const env = readEnv();
  return <ChatPanel modelName={env.modelName} env={env.env} />;
}
