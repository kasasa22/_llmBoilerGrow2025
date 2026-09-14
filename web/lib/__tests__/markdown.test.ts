import { describe, expect, it } from 'vitest';

import { normaliseAnswerHtml, renderMarkdown } from '@/lib/markdown';

describe('normaliseAnswerHtml', () => {
  it('wraps tables in a scroll container', () => {
    const html = '<p>x</p><table><thead></thead></table>';
    expect(normaliseAnswerHtml(html)).toBe('<p>x</p><div class="table-wrap"><table><thead></thead></table></div>');
  });

  it('turns bold-only label paragraphs into section labels', () => {
    expect(normaliseAnswerHtml('<p><strong>Which to choose:</strong></p>')).toBe(
      '<h4 class="answer-label">Which to choose</h4>',
    );
    expect(normaliseAnswerHtml('<p><strong>Summary</strong>:</p>')).toBe('<h4 class="answer-label">Summary</h4>');
  });

  it('leaves paragraphs with more than a bold label alone', () => {
    const html = '<p><strong>FastAPI</strong> is fast [1].</p>';
    expect(normaliseAnswerHtml(html)).toBe(html);
  });
});

describe('renderMarkdown', () => {
  it('renders a GFM table inside the wrapper', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = renderMarkdown(md);
    expect(html).toContain('<div class="table-wrap"><table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('keeps citation markers as text', () => {
    expect(renderMarkdown('Fast [1].')).toContain('Fast [1].');
  });
});
