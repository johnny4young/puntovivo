import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openPrintMock, warningMock } = vi.hoisted(() => ({
  openPrintMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/printWindow', () => ({ openHtmlInPrintWindow: openPrintMock }));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: warningMock }),
}));

import { ShelfLabelsModal } from './ShelfLabelsModal';

const PRODUCTS = [
  { id: 'p1', name: 'Arroz 1kg', sku: 'ARR-001', barcode: null, price: 4200, copies: 1 },
];

describe('ShelfLabelsModal', () => {
  beforeEach(() => {
    openPrintMock.mockReset();
    warningMock.mockReset();
    delete (window as { electron?: unknown }).electron;
  });

  it('prints the sheet through the shared blob print window with auto-print', () => {
    openPrintMock.mockReturnValue({} as Window);
    render(<ShelfLabelsModal isOpen products={PRODUCTS} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('labels.printSheet'));

    expect(openPrintMock).toHaveBeenCalledTimes(1);
    const [html] = openPrintMock.mock.calls[0]!;
    expect(html).toContain('window.print()');
    expect(html).toContain('Arroz 1kg');
    expect(warningMock).not.toHaveBeenCalled();
  });

  it('warns when the print window is blocked', () => {
    openPrintMock.mockReturnValue(null);
    render(<ShelfLabelsModal isOpen products={PRODUCTS} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('labels.printSheet'));

    expect(warningMock).toHaveBeenCalledWith({ title: 'labels.popupBlocked' });
  });

  it('prints through the desktop document bridge without a popup or script', async () => {
    const printDocument = vi.fn(async () => ({ success: true }));
    (window as { electron?: unknown }).electron = { printDocument };
    render(<ShelfLabelsModal isOpen products={PRODUCTS} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('labels.printSheet'));

    await waitFor(() => expect(printDocument).toHaveBeenCalledTimes(1));
    const [html] = printDocument.mock.calls[0] as unknown as [string];
    expect(html).not.toContain('<script');
    expect(html).toContain('<path d="M');
    expect(openPrintMock).not.toHaveBeenCalled();
  });

  it('stays quiet on a cancelled desktop dialog and warns on a failed job', async () => {
    const printDocument = vi
      .fn()
      .mockResolvedValueOnce({ success: false, errorCode: 'PRINT_CANCELLED' })
      .mockResolvedValueOnce({ success: false, error: 'Printer offline' });
    (window as { electron?: unknown }).electron = { printDocument };
    render(<ShelfLabelsModal isOpen products={PRODUCTS} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('labels.printSheet'));
    await waitFor(() => expect(printDocument).toHaveBeenCalledTimes(1));
    expect(warningMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('labels.printSheet'));
    await waitFor(() => expect(warningMock).toHaveBeenCalledWith({ title: 'Printer offline' }));
  });
});
