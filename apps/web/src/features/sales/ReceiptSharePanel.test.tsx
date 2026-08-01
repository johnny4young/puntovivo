import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  data: {
    status: 'ready' as 'ready' | 'text-fallback',
    html: '<html><body>Receipt V-1</body></html>' as string | null,
    text: 'Receipt V-1\nTotal: $10',
    saleNumber: 'V-1',
    locale: 'en-US',
  },
  error: null as Error | null,
  createReceiptPng: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    peripherals: {
      renderReceiptShare: {
        useQuery: () => ({ data: mocks.data, isLoading: false, error: mocks.error }),
      },
    },
  },
}));

vi.mock('@/services/export/exportService', () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock('./receiptShare', async importOriginal => {
  const actual = await importOriginal<typeof import('./receiptShare')>();
  return { ...actual, createReceiptPng: mocks.createReceiptPng };
});

import { ReceiptSharePanel } from './ReceiptSharePanel';

describe('ReceiptSharePanel', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  beforeEach(() => {
    mocks.data = {
      status: 'ready',
      html: '<html><body>Receipt V-1</body></html>',
      text: 'Receipt V-1\nTotal: $10',
      saleNumber: 'V-1',
      locale: 'en-US',
    };
    mocks.error = null;
    mocks.createReceiptPng.mockReset().mockResolvedValue(new Blob(['png']));
    mocks.downloadFile.mockReset();
  });

  it('explains the manual handoff and prepares a local image without uploading it', async () => {
    render(<ReceiptSharePanel saleId="sale-1" siteId="site-1" onClose={vi.fn()} />);

    expect(
      screen.getByText(/does not choose the contact or send the message/i)
    ).toBeInTheDocument();
    const link = screen.getByTestId('receipt-share-whatsapp');
    expect(link).toHaveAttribute('href', 'https://wa.me/?text=Receipt%20V-1%0ATotal%3A%20%2410');

    fireEvent.click(link);
    await waitFor(() => expect(mocks.createReceiptPng).toHaveBeenCalledWith(mocks.data.html));
    expect(mocks.downloadFile).toHaveBeenCalledWith(expect.any(Blob), 'puntovivo-recibo-v-1.png');
    expect(await screen.findByRole('status')).toHaveTextContent('Image downloaded');
  });

  it('keeps the prepared WhatsApp text available when image generation fails', async () => {
    mocks.createReceiptPng.mockRejectedValue(new Error('Canvas unavailable'));
    render(<ReceiptSharePanel saleId="sale-1" siteId="site-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('receipt-share-whatsapp'));

    expect(await screen.findByRole('alert')).toHaveTextContent('image is unavailable');
    expect(screen.getByTestId('receipt-share-whatsapp')).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/?text=')
    );
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it('uses neutral Latin American Spanish copy', async () => {
    await act(async () => i18next.changeLanguage('es'));
    render(<ReceiptSharePanel saleId="sale-1" siteId="site-1" onClose={vi.fn()} />);

    expect(screen.getByText('Antes de continuar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir WhatsApp' })).toBeInTheDocument();
    expect(screen.getByText(/Debes adjuntarla manualmente/)).toBeInTheDocument();
    await act(async () => i18next.changeLanguage('en'));
  });
});
