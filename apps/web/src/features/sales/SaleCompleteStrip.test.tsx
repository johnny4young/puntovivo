import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  printReceipt: vi.fn(),
  fetchSale: vi.fn(),
  toastWarning: vi.fn(),
  site: { id: 'site-1', name: 'Central' } as { id: string; name: string } | null,
}));

vi.mock('./useSaleReceiptPrinter', () => ({
  useSaleReceiptPrinter: () => mocks.printReceipt,
}));

vi.mock('./ReceiptSharePanel', () => ({
  ReceiptSharePanel: ({ saleId, onClose }: { saleId: string; onClose: () => void }) => (
    <div data-testid="receipt-share-panel">
      {saleId}
      <button type="button" onClick={onClose}>
        Close review
      </button>
    </div>
  ),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: mocks.site }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: mocks.toastWarning,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ sales: { getById: { fetch: mocks.fetchSale } } }),
  },
}));

import { SaleCompleteStrip } from './SaleCompleteStrip';

const sale = { id: 'sale-1', saleNumber: 'VTA-N-000420', total: 41700, change: 8300 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.site = { id: 'site-1', name: 'Central' };
  mocks.fetchSale.mockResolvedValue({ id: 'sale-1', saleNumber: 'VTA-N-000420' });
  mocks.printReceipt.mockResolvedValue('printed');
});

describe('SaleCompleteStrip', () => {
  it('states the sale, the charge and the change, and offers the receipt', async () => {
    const onOpenReceipt = vi.fn();
    const onDismiss = vi.fn();
    render(<SaleCompleteStrip sale={sale} onOpenReceipt={onOpenReceipt} onDismiss={onDismiss} />);

    const strip = screen.getByTestId('sale-complete-strip');
    expect(strip).toHaveTextContent('VTA-N-000420 done, the till is back on the scanner');
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

  it('prints the receipt of that sale without leaving the strip', async () => {
    render(<SaleCompleteStrip sale={sale} onOpenReceipt={vi.fn()} onDismiss={vi.fn()} />);

    await userEvent.click(screen.getByTestId('sale-complete-print'));

    await waitFor(() => expect(mocks.printReceipt).toHaveBeenCalledOnce());
    expect(mocks.fetchSale).toHaveBeenCalledWith({ id: 'sale-1' });
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(screen.getByTestId('sale-complete-print')).toBeEnabled();
  });

  it('says so when the receipt could not be printed', async () => {
    mocks.printReceipt.mockResolvedValue('failed');
    render(<SaleCompleteStrip sale={sale} onOpenReceipt={vi.fn()} onDismiss={vi.fn()} />);

    await userEvent.click(screen.getByTestId('sale-complete-print'));

    await waitFor(() =>
      expect(mocks.toastWarning).toHaveBeenCalledWith({
        title: 'The receipt could not be printed. Open the receipt to try again.',
      })
    );
  });

  it('opens the WhatsApp review inline and closes it again', async () => {
    render(<SaleCompleteStrip sale={sale} onOpenReceipt={vi.fn()} onDismiss={vi.fn()} />);
    const whatsapp = screen.getByTestId('sale-complete-whatsapp');
    expect(whatsapp).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(whatsapp);
    expect(await screen.findByTestId('receipt-share-panel')).toHaveTextContent('sale-1');
    expect(whatsapp).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Close review' }));
    expect(screen.queryByTestId('receipt-share-panel')).not.toBeInTheDocument();
  });

  it('does not offer WhatsApp without an active site', () => {
    mocks.site = null;
    render(<SaleCompleteStrip sale={sale} onOpenReceipt={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.queryByTestId('sale-complete-whatsapp')).not.toBeInTheDocument();
  });
});
