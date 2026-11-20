import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import { LastReadBanner } from './LastReadBanner';
import type { LastRead } from './useLastRead';

const READ: LastRead = {
  key: 'bread:unit',
  quantity: 1,
  productName: 'Sliced Bread 600 g',
  unitPrice: 6800,
  remaining: 14,
};

describe('LastReadBanner', () => {
  it('confirms the product, its price and what is left', () => {
    render(<LastReadBanner read={READ} canUndo onUndo={vi.fn()} />);

    const banner = screen.getByTestId('sales-last-read');
    expect(banner).toHaveAttribute('data-state', 'read');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner).toHaveTextContent('Last read');
    expect(banner).toHaveTextContent('Sliced Bread 600 g');
    expect(screen.getByTestId('sales-last-read-price')).toHaveTextContent(formatCurrency(6800));
    expect(screen.getByTestId('sales-last-read-stock')).toHaveTextContent('14 left');
  });

  it('undoes through the cart undo and names its shortcut', () => {
    const onUndo = vi.fn();
    render(<LastReadBanner read={READ} canUndo onUndo={onUndo} />);

    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo.getAttribute('aria-keyshortcuts')).toMatch(/\+Z$/);
    // Voice control users say the visible words, so they must contain the name.
    const words = [...undo.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join(' ');
    expect(words).toMatch(/\bundo\b/i);
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('offers no undo on a ticket that cannot be undone', () => {
    render(<LastReadBanner read={READ} canUndo={false} onUndo={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('omits stock for a line that holds none', () => {
    render(<LastReadBanner read={{ ...READ, remaining: null }} canUndo onUndo={vi.fn()} />);
    expect(screen.queryByTestId('sales-last-read-stock')).not.toBeInTheDocument();
  });

  it('keeps the same slot with nothing read', () => {
    const { rerender } = render(<LastReadBanner read={null} canUndo={false} onUndo={vi.fn()} />);

    const idle = screen.getByTestId('sales-last-read');
    expect(idle).toHaveAttribute('data-state', 'idle');
    expect(idle).toHaveTextContent('Nothing read on this ticket yet');
    expect(screen.queryByTestId('sales-last-read-price')).not.toBeInTheDocument();

    rerender(<LastReadBanner read={READ} canUndo onUndo={vi.fn()} />);
    // Same element, so the ticket under it does not move when a read arrives.
    expect(screen.getByTestId('sales-last-read')).toBe(idle);
    expect(idle).toHaveClass('sales-last-read');
  });
});
