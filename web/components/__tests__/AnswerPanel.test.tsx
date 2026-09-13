import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnswerPanel } from '@/components/AnswerPanel';

describe('AnswerPanel', () => {
  it('renders nothing when answer is null', () => {
    const { container } = render(<AnswerPanel answer={null} citations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders citation links with target=_blank rel=noopener', () => {
    render(
      <AnswerPanel
        answer="one paragraph"
        citations={[
          { n: 1, url: 'https://civo.com/kubernetes', title: 'Civo Kubernetes' },
          { n: 2, url: 'https://kubernetes.io/docs', title: 'K8s docs' },
        ]}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      const rel = link.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }
    expect(screen.getByText('Civo Kubernetes')).toBeInTheDocument();
  });

  it('labels partial answers explicitly', () => {
    render(<AnswerPanel answer="short" citations={[]} partial />);
    expect(screen.getByRole('heading', { name: /partial answer/i })).toBeInTheDocument();
  });
});
