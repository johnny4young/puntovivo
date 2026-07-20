import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { CustomerBalanceImportWorkflow } from './CustomerBalanceImportWorkflow';

const mocks = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  importMutate: vi.fn(),
  invalidateCustomers: vi.fn(),
  invalidateLedger: vi.fn(),
  invalidateBalance: vi.fn(),
  toastSuccess: vi.fn(),
  exportToCSV: vi.fn(),
}));

const preview = {
  dataMode: 'real' as const,
  previewHash: 'balance-preview-hash',
  summary: { total: 3, ready: 1, duplicates: 1, invalid: 1 },
  rows: [
    {
      rowNumber: 2,
      status: 'ready' as const,
      normalized: {
        customerId: 'customer-1',
        customerName: 'Cliente con cartera',
        taxId: '9001',
        email: 'cartera@ejemplo.com',
        openingBalance: 1234.5,
        note: 'Sistema anterior',
      },
      issues: [],
    },
    {
      rowNumber: 3,
      status: 'duplicate' as const,
      normalized: {
        customerId: 'customer-2',
        customerName: 'Cliente con movimientos',
        taxId: '9002',
        email: null,
        openingBalance: 50,
        note: null,
      },
      issues: [{ code: 'duplicate_existing_balance' as const, field: 'openingBalance' as const }],
    },
    {
      rowNumber: 4,
      status: 'invalid' as const,
      normalized: {
        customerId: null,
        customerName: null,
        taxId: '9999',
        email: null,
        openingBalance: 10,
        note: null,
      },
      issues: [{ code: 'customer_not_found' as const, field: 'taxId' as const }],
    },
  ],
};

const report = {
  dataMode: 'real' as const,
  importId: 'balance-import-1',
  completedAt: '2026-07-15T16:00:00.000Z',
  summary: { total: 3, imported: 1, skipped: 1, invalid: 1, failed: 0, warnings: 0 },
  importedRows: [
    {
      rowNumber: 2,
      customerId: 'customer-1',
      adjustmentId: 'adjustment-1',
      amount: 1234.5,
      issues: [],
    },
  ],
  skippedRows: [
    {
      rowNumber: 3,
      issues: [{ code: 'duplicate_existing_balance' as const, field: 'openingBalance' as const }],
    },
  ],
  failedRows: [] as Array<{
    rowNumber: number;
    issues: Array<{ code: 'import_failed'; field: 'openingBalance' }>;
  }>,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      customers: { list: { invalidate: mocks.invalidateCustomers } },
      customerLedger: {
        list: { invalidate: mocks.invalidateLedger },
        getBalance: { invalidate: mocks.invalidateBalance },
      },
    }),
    launchMigration: {
      previewCustomerBalances: {
        useMutation: (options: { onSuccess: (result: typeof preview) => void }) => ({
          mutate: (input: unknown) => {
            mocks.previewMutate(input);
            options.onSuccess(preview);
          },
          isPending: false,
          reset: vi.fn(),
        }),
      },
      importCustomerBalances: {
        useMutation: (options: { onSuccess: (result: typeof report) => Promise<void> }) => ({
          mutate: (input: unknown) => {
            mocks.importMutate(input);
            void options.onSuccess(report);
          },
          isPending: false,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: vi.fn() }),
}));

vi.mock('@/services/export/exportService', () => ({
  exportToCSV: mocks.exportToCSV,
}));

describe(' CustomerBalanceImportWorkflow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const invalidate of [
      mocks.invalidateCustomers,
      mocks.invalidateLedger,
      mocks.invalidateBalance,
    ]) {
      invalidate.mockResolvedValue(undefined);
    }
    await i18next.changeLanguage('es');
    await i18next.loadNamespaces('dataImport');
  });

  it('maps, previews, commits, refreshes ledgers, and exports a row-complete report', async () => {
    const user = userEvent.setup();
    render(<CustomerBalanceImportWorkflow dataMode="real" />);
    await user.upload(
      screen.getByLabelText('Elegir CSV o Excel'),
      new File(
        [
          'Identificación tributaria;Correo electrónico;Cartera inicial;Nota\n',
          '9001;cartera@ejemplo.com;1.234,50;Sistema anterior\n',
          '9002;;50;\n',
          '9999;;10;\n',
        ],
        'cartera-inicial.csv',
        { type: 'text/csv' }
      )
    );

    expect(await screen.findByText('cartera-inicial.csv')).toBeInTheDocument();
    expect(screen.getByLabelText(/Identificación tributaria/)).toHaveValue(
      'Identificación tributaria'
    );
    expect(screen.getByLabelText(/Saldo inicial por cobrar/)).toHaveValue('Cartera inicial');
    await user.selectOptions(screen.getByLabelText('Formato numérico'), 'comma');
    await user.click(screen.getByRole('button', { name: 'Validar y previsualizar' }));

    expect(mocks.previewMutate).toHaveBeenCalledWith({
      dataMode: 'real',
      decimalFormat: 'comma',
      sourceName: 'cartera-inicial.csv',
      rows: [
        {
          rowNumber: 2,
          values: {
            taxId: '9001',
            email: 'cartera@ejemplo.com',
            openingBalance: '1.234,50',
            note: 'Sistema anterior',
          },
        },
        {
          rowNumber: 3,
          values: { taxId: '9002', email: '', openingBalance: '50', note: '' },
        },
        {
          rowNumber: 4,
          values: { taxId: '9999', email: '', openingBalance: '10', note: '' },
        },
      ],
    });
    expect(screen.getByTestId('data-import-summary-ready')).toHaveTextContent('1');
    expect(screen.getByTestId('data-import-preview-row-3')).toHaveTextContent(
      'ya tiene movimientos'
    );
    expect(screen.getByTestId('data-import-preview-row-4')).toHaveTextContent(
      'Ningún cliente activo'
    );

    await user.click(
      screen.getByLabelText(/Confirmo que este archivo contiene datos reales del negocio/)
    );
    await user.click(screen.getByRole('button', { name: 'Importar 1 fila lista' }));
    expect(mocks.importMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedRealData: true,
        dataMode: 'real',
        decimalFormat: 'comma',
        previewHash: 'balance-preview-hash',
      })
    );
    expect(await screen.findByTestId('data-import-report')).toHaveTextContent(
      'Se registró 1 saldo inicial por cobrar.'
    );
    await waitFor(() => {
      expect(mocks.invalidateCustomers).toHaveBeenCalledOnce();
      expect(mocks.invalidateLedger).toHaveBeenCalledOnce();
      expect(mocks.invalidateBalance).toHaveBeenCalledOnce();
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith({
      title: 'Se importó 1 saldo inicial por cobrar',
    });

    await user.click(screen.getByRole('button', { name: 'Descargar novedades' }));
    expect(mocks.exportToCSV).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, status: 'Omitida' }),
        expect.objectContaining({ row: 4, status: 'Inválida' }),
      ]),
      expect.any(Array),
      'puntovivo-customer-balances-import-issues',
      { includeTimestamp: true }
    );

    await user.click(screen.getByRole('button', { name: 'Descargar reporte' }));
    expect(mocks.exportToCSV).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          status: 'Importada',
          customer: 'Cliente con cartera',
          adjustmentId: 'adjustment-1',
        }),
        expect.objectContaining({ row: 3, status: 'Omitida' }),
        expect.objectContaining({ row: 4, status: 'Inválida' }),
      ]),
      expect.any(Array),
      'puntovivo-customer-balances-import-balance-import-1',
      { includeTimestamp: true }
    );
  });
});
