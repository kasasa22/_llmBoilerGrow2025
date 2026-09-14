import type { SseEvent } from './events';

export type UserStepId = 'understand' | 'search' | 'read' | 'write' | 'done';

export interface UserStep {
  id: UserStepId;
  label: string;
  description: string;
}

export const USER_STEPS: UserStep[] = [
  { id: 'understand', label: 'Getting ready', description: 'Preparing to research' },
  { id: 'search', label: 'Search', description: 'Finding relevant sources' },
  { id: 'read', label: 'Read', description: 'Reading each source' },
  { id: 'write', label: 'Write', description: 'Composing your answer' },
];

export type StepState = 'pending' | 'active' | 'done';

export interface DerivedProgress {
  activeStepId: UserStepId;
  stepStates: Record<UserStepId, StepState>;
  sourcesFound: number;
  sourcesRead: number;
  hasError: boolean;
  isComplete: boolean;
  currentActivity: string | null;
}

export function deriveProgress(events: SseEvent[]): DerivedProgress {
  const phasesSeen = new Set(events.map((e) => e.phase));

  const searchDone = phasesSeen.has('research.search_completed');
  const anyRead = phasesSeen.has('research.source_found');
  const enteredSynthesis = events.some(
    (e) => e.phase === 'agent.transition' && e.data.to === 'synthesis',
  ) || phasesSeen.has('synthesis.started') || phasesSeen.has('synthesis.answer_ready');
  const answerReady = phasesSeen.has('synthesis.answer_ready') || phasesSeen.has('final');
  const isComplete = phasesSeen.has('done') || phasesSeen.has('final');
  const hasError =
    phasesSeen.has('error') || phasesSeen.has('network.error') || phasesSeen.has('tool.error');

  const sourcesFound = events.filter((e) => e.phase === 'research.source_found').length;
  const sourcesRead = events.filter(
    (e) => e.phase === 'rag.chunks_indexed' || e.phase === 'research.source_found',
  ).length;

  let activeStepId: UserStepId = 'understand';
  if (isComplete) activeStepId = 'done';
  else if (enteredSynthesis) activeStepId = 'write';
  else if (anyRead) activeStepId = 'read';
  else if (searchDone || phasesSeen.has('tool.called')) activeStepId = 'search';
  else activeStepId = 'understand';

  const order: UserStepId[] = ['understand', 'search', 'read', 'write'];
  const activeIdx = order.indexOf(activeStepId);
  const stepStates: Record<UserStepId, StepState> = {
    understand: 'pending',
    search: 'pending',
    read: 'pending',
    write: 'pending',
    done: 'pending',
  };
  order.forEach((id, i) => {
    if (isComplete) stepStates[id] = 'done';
    else if (i < activeIdx) stepStates[id] = 'done';
    else if (i === activeIdx) stepStates[id] = 'active';
    else stepStates[id] = 'pending';
  });
  if (isComplete) stepStates.done = 'done';

  let currentActivity: string | null = null;
  if (!isComplete) {
    const last = events[events.length - 1];
    if (last) {
      switch (last.phase) {
        case 'tool.called':
          if (last.data.tool === 'webSearch') currentActivity = 'Searching the web';
          else if (last.data.tool === 'fetchUrl') currentActivity = `Reading ${new URL(String(last.data.args?.url || 'source')).hostname}`;
          break;
        case 'research.source_found':
          currentActivity = `Found: ${last.data.title || last.data.url}`;
          break;
        case 'rag.chunks_indexed':
          currentActivity = 'Understanding the source';
          break;
        case 'agent.transition':
          if (last.data.to === 'synthesis') currentActivity = 'Writing your answer';
          else currentActivity = 'Getting ready';
          break;
        case 'synthesis.started':
          currentActivity = 'Writing your answer';
          break;
        case 'synthesis.answer_ready':
          currentActivity = 'Almost done';
          break;
      }
    }
  }

  return {
    activeStepId,
    stepStates,
    sourcesFound,
    sourcesRead,
    hasError,
    isComplete,
    currentActivity,
  };
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export function typicalTimeHint(env: string): string {
  if (env === 'prod') return 'This usually takes 5-10 seconds.';
  return 'This usually takes 30-90 seconds. First question may be a bit slower.';
}
