import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import { RestaurantPrecheckModal } from '../RestaurantPrecheckModal';

const h = vi.hoisted(() => ({
  getPrecheck: vi.fn(),
  printMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: h.toastSuccess, error: h.toastError }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      restaurantTables: { listSummary: { invalidate: h.invalidate } },
      restaurantServices: { getTableState: { invalidate: h.invalidate } },
    }),
    restaurantServices: {
      getPrecheck: { useQuery: h.getPrecheck },
      printPrecheck: {
        useMutation: () => ({ mutate: h.printMutate, isPending: false }),
      },
    },
  },
}));

describe('RestaurantPrecheckModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('es');
    await i18n.loadNamespaces('restaurants');
    h.getPrecheck.mockImplementation((input: { tipPercent?: number }) => {
      const tipPercent = input?.tipPercent ?? 10;
      const baseTotal = 50000;
      const suggestedTipAmount = (baseTotal * tipPercent) / 100;
      return {
        isLoading: false,
        isError: false,
        data: {
          isFiscalDocument: false,
          tenantName: 'Restaurante Demo',
          siteName: 'Sede Norte',
          tableId: 't-1',
          tableName: 'Mesa 1',
          checkId: 'c-1',
          checkLabel: null,
          saleNumbers: ['POS-001'],
          waiterName: 'Mesero',
          currencyCode: 'COP',
          generatedAt: '2026-11-26T20:00:00.000Z',
          items: [
            {
              saleItemId: 'si-1',
              productName: 'Ajiaco',
              quantity: 2,
              unitPrice: 25000,
              total: 50000,
              seatNumber: 1,
              modifiers: [],
              notes: null,
            },
          ],
          subtotal: 50000,
          taxAmount: 0,
          discountAmount: 0,
          serviceChargeAmount: 0,
          baseTotal,
          tipPercent,
          suggestedTipAmount,
          totalWithTip: baseTotal + suggestedTipAmount,
          voluntaryTipNoticeEs:
            'PROPINA VOLUNTARIA (Ley 1935 de 2018): Usted puede aceptarla, modificarla o rechazarla.',
          voluntaryTipNoticeEn:
            'VOLUNTARY TIP (Law 1935 of 2018): You may accept, adjust, or decline it.',
          escposDocument: { lines: [] },
        },
      };
    });
  });

  it('renders non-fiscal precheck with Law 1935/2018 notice, editable tip presets, and print trigger', () => {
    render(<RestaurantPrecheckModal tableId="t-1" tableName="Mesa 1" onClose={vi.fn()} />);

    expect(screen.getByTestId('precheck-modal')).toHaveTextContent('No es factura de venta');
    expect(screen.getByTestId('precheck-legal-notice')).toHaveTextContent('Ley 1935 de 2018');
    expect(screen.getByTestId('precheck-tip-input')).toHaveValue(10);

    fireEvent.click(screen.getByTestId('precheck-tip-preset-15'));
    expect(screen.getByTestId('precheck-tip-input')).toHaveValue(15);

    fireEvent.click(screen.getByTestId('precheck-print-cta'));
    expect(h.printMutate).toHaveBeenCalledWith({
      tableId: 't-1',
      tipPercent: 15,
      markBillRequested: true,
    });
  });
});
