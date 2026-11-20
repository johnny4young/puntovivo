import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { SaleCompleteStrip } from './SaleCompleteStrip';

const sale = { id: 'sale-1', saleNumber: 'VTA-N-000420', total: 41700, change: 8300 };

function renderStrip(overrides: Partial<Parameters<typeof SaleCompleteStrip>[0]> = {}) {
  const props = {
    sale,
    onPrint: vi.fn(),
    onShare: vi.fn(),
    onOpenReceipt: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<SaleCompleteStrip {...props} />);
  return props;
}

describe('SaleCompleteStrip', () => {
  it('states the sale, the charge and the change, and offers each receipt choice', async () => {
    const props = renderStrip();

    const strip = screen.getByTestId('sale-complete-strip');
    expect(strip).toHaveTextContent('VTA-N-000420 ready, the till is back on the scanner');
    expect(strip).toHaveTextContent(/41[,.]700/);
    expect(screen.getByTestId('sale-complete-change')).toHaveTextContent(/8[,.]300/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(props.onPrint).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'WhatsApp' }));
    expect(props.onShare).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'View receipt' }));
    expect(props.onOpenReceipt).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'No receipt' }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it('holds Print while a print is on its way', () => {
    renderStrip({ isPrinting: true });
    expect(screen.getByTestId('sale-complete-print')).toBeDisabled();
  });

  it('leaves out the change when there is none', () => {
    renderStrip({ sale: { ...sale, change: 0 } });
    expect(screen.queryByTestId('sale-complete-change')).not.toBeInTheDocument();
  });
});
