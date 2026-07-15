import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { OpeningCashImportWorkflow } from './OpeningCashImportWorkflow';

const mocks = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  importMutate: vi.fn(),
  invalidateAssignments: vi.fn(),
  toastSuccess: vi.fn(),
  exportToCSV: vi.fn(),
}));

const preview = {
  dataMode: 'real' as const,
  previewHash: 'cash-preview-hash',
  summary: { total: 3, ready: 1, duplicates: 1, invalid: 1 },
  rows: [
    {
      rowNumber: 2,
      status: 'ready' as const,
      normalized: {
        siteId: 'site-1',
        siteName: 'Sede Norte',
        registerName: 'Caja frontal',
        openingFloat: 120000,
        denominations: [
          { value: 50000, count: 2 },
          { value: 20000, count: 1 },
        ],
        operation: 'create' as const,
      },
      issues: [],
    },
    {
      rowNumber: 3,
      status: 'duplicate' as const,
      normalized: {
        siteId: 'site-1',
        siteName: 'Sede Norte',
        registerName: 'Caja existente',
        openingFloat: 50000,
        denominations: [{ value: 50000, count: 1 }],
        operation: 'create' as const,
      },
      issues: [{ code: 'duplicate_existing_register' as const, field: 'registerName' as const }],
    },
    {
      rowNumber: 4,
      status: 'invalid' as const,
      normalized: {
        siteId: null,
        siteName: 'Sede desconocida',
        registerName: 'Caja trasera',
        openingFloat: 20000,
        denominations: [{ value: 20000, count: 1 }],
        operation: 'create' as const,
      },
      issues: [{ code: 'site_not_found' as const, field: 'siteName' as const }],
    },
  ],
};

const report = {
  dataMode: 'real' as const,
  importId: 'cash-import-1',
  completedAt: '2026-07-15T17:00:00.000Z',
  summary: { total: 3, imported: 1, skipped: 1, invalid: 1, failed: 0, warnings: 0 },
  importedRows: [{ rowNumber: 2, templateId: 'template-1', issues: [] }],
  skippedRows: [
    {
      rowNumber: 3,
      issues: [{ code: 'duplicate_existing_register' as const, field: 'registerName' as const }],
    },
  ],
  invalidRows: [
    {
      rowNumber: 4,
      issues: [{ code: 'site_not_found' as const, field: 'siteName' as const }],
    },
  ],
  failedRows: [] as Array<{
    rowNumber: number;
    issues: Array<{ code: 'import_failed'; field: 'openingFloat' }>;
  }>,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      cashSessions: { registerAssignments: { invalidate: mocks.invalidateAssignments } },
    }),
    launchMigration: {
      previewOpeningCash: {
        useMutation: (options: { onSuccess: (result: typeof preview) => void }) => ({
          mutate: (input: unknown) => {
            mocks.previewMutate(input);
            options.onSuccess(preview);
          },
          isPending: false,
          reset: vi.fn(),
        }),
      },
      importOpeningCash: {
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

describe('ENG-123e OpeningCashImportWorkflow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.invalidateAssignments.mockResolvedValue(undefined);
    await i18next.changeLanguage('es');
    await i18next.loadNamespaces('dataImport');
  });

  it('maps, previews, commits, refreshes register assignments, and exports every source row', async () => {
    const user = userEvent.setup();
    render(<OpeningCashImportWorkflow dataMode="real" />);
    await user.upload(
      screen.getByLabelText('Elegir CSV o Excel'),
      new File(
        [
          'Nombre de sede;Caja;Base de apertura;Denominaciones\n',
          'Sede Norte;Caja frontal;120000;50000:2|20000:1\n',
          'Sede Norte;Caja existente;50000;50000:1\n',
          'Sede desconocida;Caja trasera;20000;20000:1\n',
        ],
        'bases-de-caja.csv',
        { type: 'text/csv' }
      )
    );

    expect(await screen.findByText('bases-de-caja.csv')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre de la sede/)).toHaveValue('Nombre de sede');
    expect(screen.getByLabelText(/Base de apertura/)).toHaveValue('Base de apertura');
    await user.click(screen.getByRole('button', { name: 'Validar y previsualizar' }));

    expect(mocks.previewMutate).toHaveBeenCalledWith({
      dataMode: 'real',
      decimalFormat: 'auto',
      sourceName: 'bases-de-caja.csv',
      rows: [
        {
          rowNumber: 2,
          values: {
            siteName: 'Sede Norte',
            registerName: 'Caja frontal',
            openingFloat: '120000',
            denominations: '50000:2|20000:1',
          },
        },
        {
          rowNumber: 3,
          values: {
            siteName: 'Sede Norte',
            registerName: 'Caja existente',
            openingFloat: '50000',
            denominations: '50000:1',
          },
        },
        {
          rowNumber: 4,
          values: {
            siteName: 'Sede desconocida',
            registerName: 'Caja trasera',
            openingFloat: '20000',
            denominations: '20000:1',
          },
        },
      ],
    });
    expect(screen.getByTestId('data-import-preview-row-3')).toHaveTextContent(
      'ya tiene una plantilla'
    );
    expect(screen.getByTestId('data-import-preview-row-4')).toHaveTextContent(
      'Ninguna sede activa'
    );

    await user.click(
      screen.getByLabelText(/Confirmo que este archivo contiene datos reales del negocio/)
    );
    await user.click(screen.getByRole('button', { name: 'Importar 1 fila lista' }));
    expect(mocks.importMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedRealData: true,
        dataMode: 'real',
        previewHash: 'cash-preview-hash',
      })
    );
    expect(await screen.findByTestId('data-import-report')).toHaveTextContent(
      'Se importó 1 plantilla de caja conciliada.'
    );
    await waitFor(() => expect(mocks.invalidateAssignments).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith({
      title: 'Se importó 1 plantilla de apertura',
    });

    await user.click(screen.getByRole('button', { name: 'Descargar novedades' }));
    expect(mocks.exportToCSV).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, status: 'Omitida' }),
        expect.objectContaining({ row: 4, status: 'Inválida' }),
      ]),
      expect.any(Array),
      'puntovivo-opening-cash-import-issues',
      { includeTimestamp: true }
    );

    await user.click(screen.getByRole('button', { name: 'Descargar reporte' }));
    expect(mocks.exportToCSV).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          status: 'Importada',
          registerName: 'Caja frontal',
          templateId: 'template-1',
        }),
        expect.objectContaining({ row: 3, status: 'Omitida' }),
        expect.objectContaining({ row: 4, status: 'Inválida' }),
      ]),
      expect.any(Array),
      'puntovivo-opening-cash-import-cash-import-1',
      { includeTimestamp: true }
    );
  });
});
