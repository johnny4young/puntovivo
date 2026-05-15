import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from '../BrandMark';

describe('BrandMark', () => {
  it('renders an accessible svg with the puntovivo label by default', () => {
    const { getByRole } = render(<BrandMark />);
    const svg = getByRole('img');
    expect(svg).toHaveAttribute('aria-label', 'Puntovivo');
  });

  it('includes the orange "punto" accent with the brand-accent CSS variable', () => {
    const { getByTestId } = render(<BrandMark />);
    const punto = getByTestId('brand-mark-punto');
    expect(punto.tagName.toLowerCase()).toBe('circle');
    expect(punto.getAttribute('fill')).toBe('var(--brand-accent-500)');
  });

  it('hides the punto accent in monochrome mode', () => {
    const { queryByTestId } = render(<BrandMark monochrome />);
    expect(queryByTestId('brand-mark-punto')).toBeNull();
  });

  it('honors a custom label and exposes it via aria-label', () => {
    const { getByRole } = render(<BrandMark label="Acme POS" />);
    expect(getByRole('img')).toHaveAttribute('aria-label', 'Acme POS');
  });

  it('marks the svg decorative when label is empty', () => {
    const { container } = render(<BrandMark label="" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('aria-label');
  });
});
