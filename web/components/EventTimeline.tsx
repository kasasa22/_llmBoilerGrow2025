'use client';

import { useEffect, useRef } from 'react';

import { TimelineEvent } from '@/components/TimelineEvent';
import type { SseEvent } from '@/lib/events';

interface EventTimelineProps {
  events: SseEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="timeline">
      <h2>Live progress</h2>
      <ol id="events" ref={listRef} aria-live="polite">
        {events.map((event) => (
          <TimelineEvent key={event.seq ?? `${event.phase}-${event.ts}`} event={event} />
        ))}
      </ol>
    </section>
  );
}
