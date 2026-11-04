import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { SaleCompleteStrip } from './SaleCompleteStrip';

const sale = { id: 'sale-1', saleNumber: 'VTA-N-000420', total: 41700, change: 8300 };

describe('SaleCompleteStrip', () => {
  it('states the charge and the change and offers the receipt', async () => {
    const onOpenReceipt = vi.fn();
    const onDismiss = vi.fn();
    render(<SaleCompleteStrip sale={sale} onOpenReceipt={onOpenReceipt} onDismiss={onDismiss} />);

    const strip = screen.getByTestId('sale-complete-strip');
    expect(strip).toHaveTextContent('VTA-N-000420');
    expect(strip).toHaveTextContent(/41[,.]700/);
    expect(screen.getByTestId('sale-complete-change')).toHaveTextContent(/8[,.]300/);

    await userEvent.click(screen.getByTestId('sale-complete-receipt'));
    expect(onOpenReceipt).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByTestId('sale-complete-dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('leaves out the change when there is none', () => {
    render(
      <SaleCompleteStrip
        sale={{ ...sale, change: 0 }}
        onOpenReceipt={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.queryByTestId('sale-complete-change')).not.toBeInTheDocument();
  });
});
