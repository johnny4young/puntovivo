import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { PartyImportWorkflow } from './PartyImportWorkflow';

const mocks = vi.hoisted(() => ({
  customerPreviewMutate: vi.fn(),
  providerPreviewMutate: vi.fn(),
  customerImportMutate: vi.fn(),
  providerImportMutate: vi.fn(),
  invalidateCustomers: vi.fn(),
  invalidateProviders: vi.fn(),
  invalidateReadiness: vi.fn(),
  toastSuccess: vi.fn(),
  exportToCSV: vi.fn(),
  customerPreviewPending: false,
  providerPreviewPending: false,
  customerImportPending: false,
  providerImportPending: false,
}));

const customerPreview = {
  previewHash: 'customer-preview-hash',
  summary: { total: 3, ready: 1, duplicates: 1, invalid: 1 },
  rows: [
    {
      rowNumber: 2,
      status: 'ready' as const,
      normalized: {
        name: 'Launch Customer',
        taxId: '9001',
        email: 'launch@example.com',
        phone: null,
        address: null,
        city: 'Bogotá',
        state: null,
        postalCode: null,
        country: null,
        notes: null,
      },
      issues: [],
    },
    {
      rowNumber: 3,
      status: 'invalid' as const,
      normalized: {
        name: '',
        taxId: null,
        email: 'broken',
        phone: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        notes: null,
      },
      issues: [
        { code: 'required' as const, field: 'name' as const },
        { code: 'invalid_email' as const, field: 'email' as const },
      ],
    },
    {
      rowNumber: 4,
      status: 'duplicate' as const,
      normalized: {
        name: 'Repeated Customer',
        taxId: '9001',
        email: null,
        phone: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        notes: null,
      },
      issues: [{ code: 'duplicate_file_tax_id' as const, field: 'taxId' as const }],
    },
  ],
};

const providerPreview = {
  previewHash: 'provider-preview-hash',
  summary: { total: 1, ready: 1, duplicates: 0, invalid: 0 },
  rows: [
    {
      rowNumber: 2,
      status: 'ready' as const,
      normalized: {
        name: 'Proveedor inicial',
        taxId: '9011',
        email: 'proveedor@ejemplo.com',
        phone: null,
        address: null,
        contactName: 'Contacto inicial',
        cityCode: 'BOG',
        cityId: 'city-1',
      },
      issues: [],
    },
  ],
};

function report(importId: string) {
  return {
    importId,
    completedAt: '2026-07-15T15:00:00.000Z',
    summary: { total: 1, imported: 1, skipped: 0, invalid: 0, failed: 0, warnings: 0 },
    importedRows: [{ rowNumber: 2, recordId: `${importId}-record`, issues: [] }],
    skippedRows: [] as Array<{
      rowNumber: number;
      issues: Array<{ code: 'duplicate_file_tax_id'; field: 'taxId' }>;
    }>,
    failedRows: [] as Array<{
      rowNumber: number;
      issues: Array<{ code: 'import_failed'; field: 'name' }>;
    }>,
  };
}

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      customers: { list: { invalidate: mocks.invalidateCustomers } },
      providers: { list: { invalidate: mocks.invalidateProviders } },
      setupReadiness: { get: { invalidate: mocks.invalidateReadiness } },
    }),
    launchMigration: {
      previewCustomers: {
        useMutation: (options: { onSuccess: (result: typeof customerPreview) => void }) => ({
          mutate: (input: unknown) => {
            mocks.customerPreviewMutate(input);
            options.onSuccess(customerPreview);
          },
          isPending: mocks.customerPreviewPending,
          reset: vi.fn(),
        }),
      },
      previewProviders: {
        useMutation: (options: { onSuccess: (result: typeof providerPreview) => void }) => ({
          mutate: (input: unknown) => {
            mocks.providerPreviewMutate(input);
            options.onSuccess(providerPreview);
          },
          isPending: mocks.providerPreviewPending,
          reset: vi.fn(),
        }),
      },
      importCustomers: {
        useMutation: (options: {
          onSuccess: (result: ReturnType<typeof report>) => Promise<void>;
        }) => ({
          mutate: (input: unknown) => {
            mocks.customerImportMutate(input);
            void options.onSuccess({
              ...report('customer-import'),
              summary: { total: 3, imported: 1, skipped: 1, invalid: 1, failed: 0, warnings: 0 },
              skippedRows: [
                {
                  rowNumber: 4,
                  issues: [{ code: 'duplicate_file_tax_id' as const, field: 'taxId' as const }],
                },
              ],
            });
          },
          isPending: mocks.customerImportPending,
          reset: vi.fn(),
        }),
      },
      importProviders: {
        useMutation: (options: {
          onSuccess: (result: ReturnType<typeof report>) => Promise<void>;
        }) => ({
          mutate: (input: unknown) => {
            mocks.providerImportMutate(input);
            void options.onSuccess(report('provider-import'));
          },
          isPending: mocks.providerImportPending,
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

describe('ENG-123b PartyImportWorkflow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.customerPreviewPending = false;
    mocks.providerPreviewPending = false;
    mocks.customerImportPending = false;
    mocks.providerImportPending = false;
    mocks.invalidateCustomers.mockResolvedValue(undefined);
    mocks.invalidateProviders.mockResolvedValue(undefined);
    mocks.invalidateReadiness.mockResolvedValue(undefined);
    await i18next.changeLanguage('en');
    await i18next.loadNamespaces('dataImport');
  });

  it('maps, previews, imports, and exports a row-complete customer report', async () => {
    const user = userEvent.setup();
    render(<PartyImportWorkflow entity="customers" />);
    await user.upload(
      screen.getByLabelText('Choose CSV or Excel'),
      new File(
        [
          'Customer name,Tax ID,Email,City\n',
          'Launch Customer,9001,launch@example.com,Bogotá\n',
          ',,broken,\n',
          'Repeated Customer,9001,,\n',
        ],
        'launch-customers.csv',
        { type: 'text/csv' }
      )
    );

    expect(await screen.findByText('launch-customers.csv')).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue('Customer name');
    expect(screen.getByLabelText(/Tax ID/)).toHaveValue('Tax ID');
    await user.click(screen.getByRole('button', { name: 'Validate and preview' }));
    expect(mocks.customerPreviewMutate).toHaveBeenCalledWith({
      sourceName: 'launch-customers.csv',
      rows: expect.arrayContaining([
        {
          rowNumber: 2,
          values: {
            name: 'Launch Customer',
            taxId: '9001',
            email: 'launch@example.com',
            city: 'Bogotá',
          },
        },
      ]),
    });
    expect(screen.getByTestId('data-import-summary-ready')).toHaveTextContent('1');
    expect(screen.getByTestId('data-import-preview-row-3')).toHaveTextContent(
      'Email format is not valid'
    );

    await user.click(screen.getByRole('button', { name: 'Import 1 ready row' }));
    expect(mocks.customerImportMutate).toHaveBeenCalledWith(
      expect.objectContaining({ previewHash: 'customer-preview-hash' })
    );
    expect(await screen.findByTestId('data-import-report')).toHaveTextContent(
      'Customers created: 1.'
    );
    await waitFor(() => {
      expect(mocks.invalidateCustomers).toHaveBeenCalledOnce();
      expect(mocks.invalidateProviders).not.toHaveBeenCalled();
      expect(mocks.invalidateReadiness).toHaveBeenCalledOnce();
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith({ title: '1 customer imported' });

    await user.click(screen.getByRole('button', { name: 'Download issues' }));
    expect(mocks.exportToCSV).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, status: 'Invalid', issue: 'Email format is not valid' }),
        expect.objectContaining({
          row: 4,
          status: 'Skipped',
          issue: 'Tax ID is repeated in this file',
        }),
      ]),
      expect.any(Array),
      'puntovivo-customers-import-issues',
      { includeTimestamp: true }
    );

    await user.click(screen.getByRole('button', { name: 'Download report' }));
    expect(mocks.exportToCSV).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, status: 'Imported', recordId: 'customer-import-record' }),
        expect.objectContaining({ row: 3, status: 'Invalid' }),
        expect.objectContaining({ row: 4, status: 'Skipped' }),
      ]),
      expect.any(Array),
      'puntovivo-customers-import-customer-import',
      { includeTimestamp: true }
    );
  });

  it('maps and imports a Spanish supplier with its tenant city code', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    render(<PartyImportWorkflow entity="providers" />);
    await user.upload(
      screen.getByLabelText('Elegir CSV o Excel'),
      new File(
        [
          'Nombre del proveedor;NIT;Correo electrónico;Nombre de contacto;Código de ciudad\n',
          'Proveedor inicial;9011;proveedor@ejemplo.com;Contacto inicial;BOG\n',
        ],
        'proveedores.csv',
        { type: 'text/csv' }
      )
    );

    expect(await screen.findByText('proveedores.csv')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nombre\s*\*$/)).toHaveValue('Nombre del proveedor');
    expect(screen.getByLabelText(/Código de ciudad/)).toHaveValue('Código de ciudad');
    await user.click(screen.getByRole('button', { name: 'Validar y previsualizar' }));
    expect(mocks.providerPreviewMutate).toHaveBeenCalledWith({
      sourceName: 'proveedores.csv',
      rows: [
        {
          rowNumber: 2,
          values: {
            name: 'Proveedor inicial',
            taxId: '9011',
            email: 'proveedor@ejemplo.com',
            contactName: 'Contacto inicial',
            cityCode: 'BOG',
          },
        },
      ],
    });
    const summary = screen.getByLabelText('Resumen de validación de la importación');
    expect(within(summary).getByTestId('data-import-summary-ready')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Importar 1 fila lista' }));
    expect(await screen.findByTestId('data-import-report')).toHaveTextContent(
      'Proveedores creados: 1.'
    );
    await waitFor(() => expect(mocks.invalidateProviders).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith({ title: 'Se importó 1 proveedor' });
  });
});
