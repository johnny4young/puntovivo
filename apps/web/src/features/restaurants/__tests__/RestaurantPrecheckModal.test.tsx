import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import { RestaurantPrecheckModal } from '../RestaurantPrecheckModal';

const h = vi.hoisted(() => ({
  getPrecheck: vi.fn(),
  printMutate: vi.fn(),
  printOptions: {} as { onSuccess?: (result: unknown) => Promise<void> | void },
  printHtmlDocument: vi.fn().mockResolvedValue(undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/lib/receiptDocumentPrint', () => ({
  printHtmlDocument: (opts: unknown) => h.printHtmlDocument(opts),
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
        useMutation: (opts: typeof h.printOptions) => {
          h.printOptions = opts;
          return { mutate: h.printMutate, isPending: false };
        },
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

  it('delegates browser fallback printing to printHtmlDocument with unclipped items, modifier quantities, and localized without prefix', async () => {
    await i18n.changeLanguage('en');
    h.getPrecheck.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        isFiscalDocument: false,
        tenantName: 'Demo',
        siteName: 'North',
        tableId: 't-1',
        tableName: 'Table 1',
        checkId: 'c-1',
        checkLabel: null,
        saleNumbers: ['POS-009'],
        waiterName: 'Alex',
        currencyCode: 'COP',
        generatedAt: '2026-11-26T20:00:00.000Z',
        items: [
          {
            saleItemId: 'si-1',
            productName: 'Burger',
            quantity: 1,
            unitPrice: 28000,
            total: 28000,
            seatNumber: 1,
            modifiers: [
              { name: 'Cheese', quantity: 2, unitPriceDelta: 3000, groupKind: 'extra' },
              { name: 'Onion', quantity: 1, unitPriceDelta: 0, groupKind: 'without' },
            ],
            notes: null,
          },
        ],
        subtotal: 28000,
        taxAmount: 0,
        discountAmount: 0,
        serviceChargeAmount: 0,
        baseTotal: 28000,
        tipPercent: 10,
        suggestedTipAmount: 2800,
        totalWithTip: 30800,
        voluntaryTipNoticeEs: 'ES notice',
        voluntaryTipNoticeEn: 'EN notice',
        escposDocument: { lines: [] },
      },
    });

    render(<RestaurantPrecheckModal tableId="t-1" tableName="Table 1" onClose={vi.fn()} />);
    expect(screen.getByTestId('precheck-items')).toHaveTextContent('+ 2× Cheese');
    expect(screen.getByTestId('precheck-items')).toHaveTextContent('no Onion');

    const currentData = h.getPrecheck.mock.results[0]!.value.data;
    await h.printOptions.onSuccess?.({
      precheck: currentData,
      printedVia: 'browser',
      outboxId: null,
    });
    expect(h.printHtmlDocument).toHaveBeenCalledTimes(1);
  });
});
