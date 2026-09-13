'use client';

import type { Citation } from '@/lib/events';
import { renderMarkdown } from '@/lib/markdown';

interface AnswerPanelProps {
  answer: string | null;
  citations: Citation[];
  partial?: boolean;
}

export function AnswerPanel({ answer, citations, partial }: AnswerPanelProps) {
  if (!answer) return null;

  return (
    <section id="answer-section" className="answer">
      <h2>{partial ? 'Partial answer' : 'Answer'}</h2>
      <article
        id="answer"
        className="answer-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
      />
      {citations.length > 0 ? (
        <>
          <h3>Citations</h3>
          <ol id="citations" className="citations">
            {citations.map((citation) => (
              <li key={`${citation.n}-${citation.url}`}>
                <a href={citation.url} target="_blank" rel="noopener noreferrer">
                  {citation.title || citation.url}
                </a>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
