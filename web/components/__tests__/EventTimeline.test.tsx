import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EventTimeline } from '@/components/EventTimeline';
import type { SseEvent } from '@/lib/events';

function make(overrides: Partial<SseEvent>): SseEvent {
  return {
    seq: 1,
    phase: 'tool.called',
    trace_id: 't',
    job_id: 'x',
    span_id: null,
    parent_span_id: null,
    ts: '2026-09-13T00:00:00.000Z',
    data: { tool: 'webSearch' },
    ...overrides,
  } as SseEvent;
}

describe('EventTimeline', () => {
  it('renders one <li> per event with its phase label', () => {
    const events: SseEvent[] = [
      make({ seq: 1, phase: 'job.started', data: { query: 'hi' } }),
      make({ seq: 2, phase: 'tool.called', data: { tool: 'webSearch' } }),
      make({
        seq: 3,
        phase: 'agent.transition',
        data: { from: 'research', to: 'analysis', iteration: 0 },
      }),
    ];
    render(<EventTimeline events={events} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(screen.getByText('job.started')).toBeInTheDocument();
    expect(screen.getByText('tool.called')).toBeInTheDocument();
    expect(screen.getByText('agent.transition')).toBeInTheDocument();
  });

  it('applies dotted-phase CSS class (e.g. "tool-called")', () => {
    render(<EventTimeline events={[make({ seq: 1, phase: 'tool.called' })]} />);
    const li = screen.getByRole('listitem');
    expect(li).toHaveClass('tool-called');
  });

  it('renders empty <ol> when no events', () => {
    render(<EventTimeline events={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
