import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '@/i18n';
import { formatDateTime, setActiveTenantLocale } from '@/lib/utils';
import { render } from '@/test/utils';
import { ReceiptTemplatesPage } from './ReceiptTemplatesPage';

const updatedAt = '2026-07-29T13:58:57.000Z';

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      receiptTemplates: {
        list: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    receiptTemplates: {
      list: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'template-sale-80',
                name: 'Recibo de venta — 80mm',
                kind: 'sale',
                paperWidth: '80mm',
                isDefault: true,
                isActive: true,
                updatedAt,
              },
            ],
          },
          isLoading: false,
        }),
      },
      getById: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
      setDefault: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      duplicate: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      delete: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

describe('ReceiptTemplatesPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
    setActiveTenantLocale({
      locale: 'es-CO',
      currency: 'COP',
      displayDecimals: 0,
      timezone: 'America/Bogota',
      dateFormatShort: 'dd/MM/yyyy',
    });
  });

  afterEach(() => {
    setActiveTenantLocale(null);
  });

  it('formats update timestamps with the active tenant locale', () => {
    render(<ReceiptTemplatesPage />);

    const templateRow = screen.getByTestId('receipt-template-row-template-sale-80');
    expect(templateRow).toHaveTextContent(formatDateTime(updatedAt));
    expect(templateRow).toHaveTextContent('29/07/2026');
    expect(screen.queryByText(/7\/29\/2026/)).not.toBeInTheDocument();
  });
});
