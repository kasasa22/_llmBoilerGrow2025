'use client';

import { useEffect, useState } from 'react';

import type { SseEvent } from '@/lib/events';
import {
  USER_STEPS,
  deriveProgress,
  formatElapsed,
  typicalTimeHint,
} from '@/lib/phaseMapping';

interface PhaseTrackerProps {
  events: SseEvent[];
  startedAt: number | null;
  env: string;
}

export function PhaseTracker({ events, startedAt, env }: PhaseTrackerProps) {
  const [now, setNow] = useState(() => (startedAt ? Date.now() : 0));

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const progress = deriveProgress(events);
  const elapsedMs = startedAt ? now - startedAt : 0;

  return (
    <section className="phase-tracker" aria-live="polite">
      <div className="phase-tracker-header">
        <strong>Working on your question…</strong>
        <span className="hint">{formatElapsed(elapsedMs)} elapsed</span>
      </div>

      <ol className="phase-steps">
        {USER_STEPS.map((step) => {
          const state = progress.stepStates[step.id];
          return (
            <li key={step.id} className={`phase-step phase-step--${state}`}>
              <span className="phase-step-dot" aria-hidden>
                {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
              </span>
              <div className="phase-step-body">
                <span className="phase-step-label">{step.label}</span>
                <span className="phase-step-desc">{step.description}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {progress.currentActivity ? (
        <div className="phase-current-activity">
          <span className="spinner" aria-hidden />
          <span>{progress.currentActivity}</span>
        </div>
      ) : null}

      <div className="phase-footer">
        {progress.sourcesFound > 0 ? (
          <span className="hint">
            {progress.sourcesFound} source{progress.sourcesFound === 1 ? '' : 's'} found
          </span>
        ) : null}
        <span className="hint">{typicalTimeHint(env)}</span>
      </div>
    </section>
  );
}
