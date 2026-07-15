import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { DataImportPage } from './DataImportPage';

const mocks = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  importMutate: vi.fn(),
  previewReset: vi.fn(),
  importReset: vi.fn(),
  invalidateProducts: vi.fn(),
  invalidateStock: vi.fn(),
  invalidateEntries: vi.fn(),
  invalidateReadiness: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  exportToCSV: vi.fn(),
  previewPending: false,
  importPending: false,
}));

const preview = {
  previewHash: 'preview-hash',
  summary: { total: 3, ready: 1, duplicates: 1, invalid: 1 },
  rows: [
    {
      rowNumber: 2,
      status: 'ready' as const,
      normalized: {
        name: 'Launch coffee',
        sku: 'IMP-001',
        description: null,
        barcode: null,
        price: 12.5,
        cost: 8,
        stock: 4,
        minStock: 1,
        taxRate: 19,
      },
      issues: [],
    },
    {
      rowNumber: 3,
      status: 'invalid' as const,
      normalized: {
        name: 'Missing SKU',
        sku: '',
        description: null,
        barcode: null,
        price: 0,
        cost: 0,
        stock: 0,
        minStock: 0,
        taxRate: 0,
      },
      issues: [{ code: 'required' as const, field: 'sku' as const }],
    },
    {
      rowNumber: 4,
      status: 'duplicate' as const,
      normalized: {
        name: 'Repeated product',
        sku: 'imp-001',
        description: null,
        barcode: null,
        price: 10,
        cost: 6,
        stock: 0,
        minStock: 0,
        taxRate: 0,
      },
      issues: [{ code: 'duplicate_file_sku' as const, field: 'sku' as const }],
    },
  ],
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      products: { list: { invalidate: mocks.invalidateProducts } },
      inventory: {
        listStock: { invalidate: mocks.invalidateStock },
        listEntries: { invalidate: mocks.invalidateEntries },
      },
      setupReadiness: { get: { invalidate: mocks.invalidateReadiness } },
    }),
    launchMigration: {
      previewProducts: {
        useMutation: (options: { onSuccess: (result: typeof preview) => void }) => ({
          mutate: (input: unknown) => {
            mocks.previewMutate(input);
            options.onSuccess(preview);
          },
          isPending: mocks.previewPending,
          reset: mocks.previewReset,
        }),
      },
      importProducts: {
        useMutation: (options: { onSuccess: (result: unknown) => Promise<void> }) => ({
          mutate: (input: unknown) => {
            mocks.importMutate(input);
            void options.onSuccess({
              importId: 'import-1',
              completedAt: '2026-07-15T12:00:00.000Z',
              summary: {
                total: 3,
                imported: 1,
                stockInitialized: 1,
                skipped: 1,
                invalid: 1,
                failed: 0,
                warnings: 0,
              },
              importedRows: [
                {
                  rowNumber: 2,
                  productId: 'product-1',
                  stockInitialized: true,
                  issues: [],
                },
              ],
              skippedRows: [
                {
                  rowNumber: 4,
                  issues: [{ code: 'duplicate_file_sku', field: 'sku' }],
                },
              ],
              failedRows: [],
            });
          },
          isPending: mocks.importPending,
          reset: mocks.importReset,
        }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

vi.mock('@/services/export/exportService', () => ({
  exportToCSV: mocks.exportToCSV,
}));

describe('ENG-123a DataImportPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.previewPending = false;
    mocks.importPending = false;
    for (const invalidate of [
      mocks.invalidateProducts,
      mocks.invalidateStock,
      mocks.invalidateEntries,
      mocks.invalidateReadiness,
    ]) {
      invalidate.mockResolvedValue(undefined);
    }
    await i18next.changeLanguage('en');
    await i18next.loadNamespaces('dataImport');
  });

  it('maps, previews, imports, and refreshes launch catalog state', async () => {
    const user = userEvent.setup();
    render(<DataImportPage />);

    const file = new File(
      [
        'Name,SKU,Price,Cost,Opening stock,Minimum stock,Tax rate\n',
        'Launch coffee,IMP-001,12.50,8,4,1,19\n',
        'Missing SKU,,0,0,0,0,0\n',
        'Repeated product,imp-001,10,6,0,0,0\n',
      ],
      'launch-products.csv',
      { type: 'text/csv' }
    );
    await user.upload(screen.getByLabelText('Choose CSV or Excel'), file);

    expect(await screen.findByText('launch-products.csv')).toBeInTheDocument();
    expect(screen.getByLabelText(/Product name/)).toHaveValue('Name');
    expect(screen.getByLabelText(/SKU/)).toHaveValue('SKU');
    expect(screen.getByLabelText('Opening stock')).toHaveValue('Opening stock');

    await user.click(screen.getByRole('button', { name: 'Validate and preview' }));
    expect(mocks.previewMutate).toHaveBeenCalledWith({
      sourceName: 'launch-products.csv',
      decimalFormat: 'auto',
      rows: [
        {
          rowNumber: 2,
          values: {
            name: 'Launch coffee',
            sku: 'IMP-001',
            price: '12.50',
            cost: '8',
            stock: '4',
            minStock: '1',
            taxRate: '19',
          },
        },
        {
          rowNumber: 3,
          values: {
            name: 'Missing SKU',
            sku: '',
            price: '0',
            cost: '0',
            stock: '0',
            minStock: '0',
            taxRate: '0',
          },
        },
        {
          rowNumber: 4,
          values: {
            name: 'Repeated product',
            sku: 'imp-001',
            price: '10',
            cost: '6',
            stock: '0',
            minStock: '0',
            taxRate: '0',
          },
        },
      ],
    });

    const summary = screen.getByLabelText('Import validation summary');
    expect(within(summary).getByTestId('data-import-summary-ready')).toHaveTextContent('1');
    expect(screen.getByTestId('data-import-preview-row-3')).toHaveTextContent(
      'Required value is missing'
    );

    await user.click(screen.getByRole('button', { name: 'Import 1 ready row' }));
    expect(mocks.importMutate).toHaveBeenCalledWith(
      expect.objectContaining({ previewHash: 'preview-hash' })
    );
    expect(await screen.findByTestId('data-import-report')).toHaveTextContent('Import complete');
    expect(screen.getByRole('button', { name: 'Import completed' })).toBeDisabled();
    await waitFor(() => {
      expect(mocks.invalidateProducts).toHaveBeenCalledOnce();
      expect(mocks.invalidateStock).toHaveBeenCalledOnce();
      expect(mocks.invalidateEntries).toHaveBeenCalledOnce();
      expect(mocks.invalidateReadiness).toHaveBeenCalledOnce();
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith({ title: '1 product imported' });

    await user.click(screen.getByRole('button', { name: 'Download issues' }));
    expect(mocks.exportToCSV).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({
          row: 3,
          status: 'Invalid',
          issue: 'Required value is missing',
        }),
        expect.objectContaining({
          row: 4,
          status: 'Skipped',
          issue: 'SKU is repeated in this file',
        }),
      ],
      expect.any(Array),
      'puntovivo-launch-import-issues',
      { includeTimestamp: true }
    );

    await user.click(screen.getByRole('button', { name: 'Download report' }));
    expect(mocks.exportToCSV).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          row: 2,
          status: 'Imported',
          sku: 'IMP-001',
          productId: 'product-1',
          stockInitialized: 'Yes',
        }),
        expect.objectContaining({
          row: 3,
          status: 'Invalid',
          sku: '',
          field: 'SKU',
          issue: 'Required value is missing',
        }),
        expect.objectContaining({
          row: 4,
          status: 'Skipped',
          sku: 'imp-001',
          issue: 'SKU is repeated in this file',
        }),
      ],
      expect.any(Array),
      'puntovivo-launch-import-import-1',
      { includeTimestamp: true }
    );
  });

  it('clears a rejected file so the same filename can be selected again', async () => {
    const user = userEvent.setup();
    render(<DataImportPage />);
    const input = screen.getByLabelText('Choose CSV or Excel') as HTMLInputElement;

    await user.upload(
      input,
      new File(['Name,SKU\n"unfinished,IMP-001'], 'launch-products.csv', { type: 'text/csv' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The CSV contains an unfinished or invalid quoted value.'
    );
    expect(input.value).toBe('');

    await user.upload(
      input,
      new File(['Name,SKU\nLaunch coffee,IMP-001'], 'launch-products.csv', { type: 'text/csv' })
    );
    expect(await screen.findByText('launch-products.csv')).toBeInTheDocument();
  });

  it('prevents replacing or resetting the source while a request is pending', async () => {
    const user = userEvent.setup();
    const view = render(<DataImportPage />);
    await user.upload(
      screen.getByLabelText('Choose CSV or Excel'),
      new File(['Name,SKU\nLaunch coffee,IMP-001'], 'launch-products.csv', { type: 'text/csv' })
    );
    expect(await screen.findByText('launch-products.csv')).toBeInTheDocument();

    mocks.previewPending = true;
    view.rerender(<DataImportPage />);

    expect(screen.getByLabelText('Choose CSV or Excel')).toBeDisabled();
    expect(screen.getByText('Choose CSV or Excel').closest('label')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Start over' })).toBeDisabled();
    expect(screen.getByLabelText(/Product name/)).toBeDisabled();
    expect(screen.getByLabelText(/SKU/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('button', { name: 'Validate and preview' })).toBeDisabled();
  });
});
