import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  if (typeof window === 'undefined') return raw;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'rel'],
  });
}
