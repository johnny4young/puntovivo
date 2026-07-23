import { createRef } from 'react';
import { render, screen } from '@/test/utils';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders the canonical Operator Deck recipe and semantic tone', () => {
    render(<Badge variant="success">Lista</Badge>);

    expect(screen.getByText('Lista')).toHaveClass('pv-badge', 'success');
  });

  it('maps the compatibility secondary variant to the neutral recipe', () => {
    render(<Badge variant="secondary">Sin probar</Badge>);

    expect(screen.getByText('Sin probar')).toHaveClass('pv-badge', 'neutral');
  });

  it('renders an aria-hidden dot marker without replacing the label', () => {
    render(
      <Badge variant="warning" marker="dot">
        Revisar
      </Badge>
    );

    const badge = screen.getByText('Revisar');
    expect(badge.querySelector('.dot')).toHaveAttribute('aria-hidden', 'true');
    expect(badge).toHaveTextContent('Revisar');
  });

  it('forwards span attributes, classes, and refs', () => {
    const ref = createRef<HTMLSpanElement>();
    render(
      <Badge ref={ref} variant="info" className="ml-auto" role="status">
        En cola
      </Badge>
    );

    expect(screen.getByRole('status')).toHaveClass('pv-badge', 'info', 'ml-auto');
    expect(ref.current?.tagName).toBe('SPAN');
  });
});
