import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SeverityMark, type Severity } from './SeverityMark';

describe('SeverityMark', () => {
  it.each<Severity>(['blocks', 'beforeClose', 'whenPossible', 'ready'])(
    'renders a distinct shape for %s',
    severity => {
      const { container } = render(<SeverityMark severity={severity} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('data-severity', severity);
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg?.children.length).toBeGreaterThan(0);
    }
  );

  it('exposes an accessible name when labelled', () => {
    render(<SeverityMark severity="blocks" label="Bloquea" />);
    expect(screen.getByRole('img', { name: 'Bloquea' })).toBeInTheDocument();
  });
});
