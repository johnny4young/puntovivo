import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { FiscalProfileImportWorkflow } from './FiscalProfileImportWorkflow';

const mocks = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  importMutate: vi.fn(),
  invalidateFiscal: vi.fn(),
  invalidateReadiness: vi.fn(),
  invalidateCheckout: vi.fn(),
  toastSuccess: vi.fn(),
  exportToCSV: vi.fn(),
}));

const preview = {
  dataMode: 'real' as const,
  activationRequired: true as const,
  tenantCountryCode: 'CO' as const,
  previewHash: 'fiscal-preview-hash',
  summary: { total: 2, ready: 1, duplicates: 0, invalid: 1 },
  rows: [
    {
      rowNumber: 2,
      status: 'ready' as const,
      normalized: {
        countryCode: 'CO' as const,
        taxIdentifier: '900123456-7',
        economicActivityCode: null,
        issueLocation: null,
        administrativeAreaCode: null,
        resolutionNumber: '18764000001234',
        numberingPrefix: 'SETT',
        rangeFrom: 1,
        rangeTo: 5000,
        environment: 'habilitacion',
        activationRequired: true as const,
      },
      issues: [],
    },
    {
      rowNumber: 3,
      status: 'invalid' as const,
      normalized: {
        countryCode: 'MX' as const,
        taxIdentifier: 'XEXX010101000',
        economicActivityCode: '601',
        issueLocation: '01000',
        administrativeAreaCode: null,
        resolutionNumber: null,
        numberingPrefix: null,
        rangeFrom: null,
        rangeTo: null,
        environment: 'sandbox',
        activationRequired: true as const,
      },
      issues: [{ code: 'tenant_country_mismatch' as const, field: 'countryCode' as const }],
    },
  ],
};

const report = {
  importId: 'fiscal-import-1',
  dataMode: 'real' as const,
  completedAt: '2026-07-15T17:00:00.000Z',
  activationRequired: true as const,
  summary: { total: 2, imported: 1, skipped: 0, invalid: 1, failed: 0, warnings: 0 },
  importedRows: [{ rowNumber: 2, countryCode: 'CO' as const, issues: [] }],
  skippedRows: [],
  invalidRows: [
    {
      rowNumber: 3,
      issues: [{ code: 'tenant_country_mismatch' as const, field: 'countryCode' as const }],
    },
  ],
  failedRows: [],
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      fiscalSettings: { getByCountry: { invalidate: mocks.invalidateFiscal } },
      setupReadiness: {
        get: { invalidate: mocks.invalidateReadiness },
        checkout: { invalidate: mocks.invalidateCheckout },
      },
    }),
    launchMigration: {
      previewFiscalProfiles: {
        useMutation: (options: { onSuccess: (result: typeof preview) => void }) => ({
          mutate: (input: unknown) => {
            mocks.previewMutate(input);
            options.onSuccess(preview);
          },
          isPending: false,
          reset: vi.fn(),
        }),
      },
      importFiscalProfiles: {
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

vi.mock('@/services/export/exportService', () => ({ exportToCSV: mocks.exportToCSV }));

describe(' FiscalProfileImportWorkflow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const invalidate of [
      mocks.invalidateFiscal,
      mocks.invalidateReadiness,
      mocks.invalidateCheckout,
    ]) {
      invalidate.mockResolvedValue(undefined);
    }
    await i18next.changeLanguage('es');
    await i18next.loadNamespaces('dataImport');
  });

  it('maps, previews, commits disabled, refreshes fiscal state, and exports finalized rows', async () => {
    const user = userEvent.setup();
    render(<FiscalProfileImportWorkflow dataMode="real" />);
    await user.upload(
      screen.getByLabelText('Elegir CSV o Excel'),
      new File(
        [
          'Código de país;NIT;Resolución de numeración;Prefijo;Consecutivo inicial;Consecutivo final;Ambiente fiscal\n',
          'CO;900123456-7;18764000001234;SETT;1;5000;habilitación\n',
          'MX;XEXX010101000;;;;;sandbox\n',
        ],
        'perfil-fiscal.csv',
        { type: 'text/csv' }
      )
    );

    expect(await screen.findByText('perfil-fiscal.csv')).toBeInTheDocument();
    expect(screen.getByLabelText(/Código de país/)).toHaveValue('Código de país');
    expect(screen.getByLabelText(/Identificación tributaria/)).toHaveValue('NIT');
    await user.click(screen.getByRole('button', { name: 'Validar y previsualizar' }));

    expect(mocks.previewMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        dataMode: 'real',
        sourceName: 'perfil-fiscal.csv',
        rows: [
          expect.objectContaining({
            rowNumber: 2,
            values: expect.objectContaining({
              countryCode: 'CO',
              taxIdentifier: '900123456-7',
              resolutionNumber: '18764000001234',
            }),
          }),
          expect.objectContaining({ rowNumber: 3 }),
        ],
      })
    );
    expect(screen.getByTestId('data-import-fiscal-activation-boundary')).toHaveTextContent(
      'permanecen desactivados'
    );
    expect(screen.getByTestId('data-import-preview-row-3')).toHaveTextContent(
      'no coincide con el país del negocio'
    );

    await user.click(
      screen.getByLabelText(/Confirmo que este archivo contiene datos reales del negocio/)
    );
    await user.click(screen.getByRole('button', { name: 'Importar 1 fila lista' }));
    expect(mocks.importMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedRealData: true,
        previewHash: 'fiscal-preview-hash',
      })
    );
    expect(await screen.findByTestId('data-import-report')).toHaveTextContent(
      'Se importó 1 perfil fiscal y quedó desactivado para revisión.'
    );
    expect(screen.getByRole('link', { name: /Revisar perfil fiscal/ })).toHaveAttribute(
      'href',
      '/company?tab=fiscal'
    );
    await waitFor(() => {
      expect(mocks.invalidateFiscal).toHaveBeenCalledOnce();
      expect(mocks.invalidateReadiness).toHaveBeenCalledOnce();
      expect(mocks.invalidateCheckout).toHaveBeenCalledOnce();
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith({
      title: 'Se importó 1 perfil fiscal',
    });

    await user.click(screen.getByRole('button', { name: 'Descargar novedades' }));
    expect(mocks.exportToCSV).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, status: 'Inválida', countryCode: 'MX' }),
      ]),
      expect.any(Array),
      'puntovivo-fiscal-profile-import-issues',
      { includeTimestamp: true }
    );
    await user.click(screen.getByRole('button', { name: 'Descargar reporte' }));
    expect(mocks.exportToCSV).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, status: 'Importada', countryCode: 'CO' }),
        expect.objectContaining({ row: 3, status: 'Inválida', countryCode: 'MX' }),
      ]),
      expect.any(Array),
      'puntovivo-fiscal-profile-import-fiscal-import-1',
      { includeTimestamp: true }
    );
  });
});
