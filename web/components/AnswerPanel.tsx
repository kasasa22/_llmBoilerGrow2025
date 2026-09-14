'use client';

import type { Citation } from '@/lib/events';
import { renderMarkdown } from '@/lib/markdown';

interface AnswerPanelProps {
  answer: string | null;
  citations: Citation[];
  partial?: boolean;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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
          <h3>Sources</h3>
          <ol id="citations" className="citations">
            {citations.map((citation) => (
              <li key={`${citation.n}-${citation.url}`}>
                <span className="citation-n">{citation.n}</span>
                <span className="citation-main">
                  <a href={citation.url} target="_blank" rel="noopener noreferrer">
                    {citation.title || citation.url}
                  </a>
                  <span className="citation-host">{hostnameOf(citation.url)}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
