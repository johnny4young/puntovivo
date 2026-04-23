import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18next from '@/i18n';
import { render } from '@/test/utils';
import { ReceiptTemplatePreview } from './ReceiptTemplatePreview';

const useQueryMock = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    receiptTemplates: {
      renderPreview: {
        useQuery: (...args: unknown[]) => useQueryMock(...args),
      },
    },
  },
}));

const layout = {
  paperWidth: '80mm' as const,
  blocks: [{ type: 'text' as const, value: 'Hola' }],
};

describe('ReceiptTemplatePreview', () => {
  beforeEach(async () => {
    useQueryMock.mockReset();
    await i18next.changeLanguage('es');
  });

  it('passes localized preview labels to the renderPreview query', () => {
    useQueryMock.mockReturnValue({
      data: { html: '<p>ok</p>', escposByteLength: 42 },
      isLoading: false,
      error: null,
    });

    render(<ReceiptTemplatePreview layout={layout} kind="sale" />);

    expect(useQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'sale',
        labels: expect.objectContaining({
          documentTitle: 'Vista previa del recibo',
          itemColumns: expect.objectContaining({
            name: 'Ítem',
            qty: 'Cant.',
          }),
          tendersTable: expect.objectContaining({
            method: 'Método',
            reference: 'Referencia',
            amount: 'Monto',
            change: 'Cambio',
          }),
        }),
      }),
      expect.objectContaining({
        refetchOnWindowFocus: false,
        staleTime: Infinity,
      })
    );
  });

  it('translates stable server error codes instead of rendering the raw message', () => {
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: {
        message: 'Receipt template not found',
        data: { errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND' },
      },
    });

    render(<ReceiptTemplatePreview layout={layout} kind="sale" />);

    expect(
      screen.getByText('No se pudo encontrar la plantilla de recibo.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Receipt template not found')
    ).not.toBeInTheDocument();
  });
});
