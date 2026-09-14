import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

const BOLD_LABEL_PARAGRAPH = /<p><strong>([^<]{1,80}?):?<\/strong>:?<\/p>/g;

export function normaliseAnswerHtml(html: string): string {
  return html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(BOLD_LABEL_PARAGRAPH, '<h4 class="answer-label">$1</h4>');
}

export function renderMarkdown(md: string): string {
  const raw = normaliseAnswerHtml(marked.parse(md, { async: false }) as string);
  if (typeof window === 'undefined') return raw;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'rel'],
  });
}
