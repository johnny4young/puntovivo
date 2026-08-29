import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';

const {
  accountingUseQueryMock,
  settingsUseQueryMock,
  sitesUseQueryMock,
  updateAccountsMutateMock,
  rememberSiteMutateMock,
  rememberSiteResetMock,
} = vi.hoisted(() => ({
  accountingUseQueryMock: vi.fn(),
  settingsUseQueryMock: vi.fn(),
  sitesUseQueryMock: vi.fn(),
  updateAccountsMutateMock: vi.fn(),
  rememberSiteMutateMock: vi.fn(),
  rememberSiteResetMock: vi.fn(),
}));

const pucAccounts = {
  paymentMethods: {
    cash: '110505',
    card: '111005',
    transfer: '111005',
    credit: '130505',
    other: '110505',
  },
  income: '413595',
  iva: '240802',
  inc: '246205',
  tips: '238095',
  receivable: '130505',
  refunds: '417595',
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sites: {
      list: {
        useQuery: () => sitesUseQueryMock(),
      },
    },
    reports: {
      accounting: {
        vouchers: {
          useQuery: (input: unknown, options: unknown) => accountingUseQueryMock(input, options),
        },
        settings: {
          useQuery: () => settingsUseQueryMock(),
        },
        updateAccounts: {
          useMutation: () => ({
            mutate: updateAccountsMutateMock,
            isPending: false,
            error: null,
          }),
        },
        rememberSite: {
          useMutation: () => ({
            mutate: rememberSiteMutateMock,
            reset: rememberSiteResetMock,
            isSuccess: false,
            error: null,
          }),
        },
      },
    },
  },
}));

import { AccountingExportPage } from './AccountingExportPage';

beforeEach(() => {
  accountingUseQueryMock.mockReset();
  settingsUseQueryMock.mockReset();
  sitesUseQueryMock.mockReset();
  updateAccountsMutateMock.mockReset();
  rememberSiteMutateMock.mockReset();
  rememberSiteResetMock.mockReset();
  sitesUseQueryMock.mockReturnValue({
    data: {
      items: [
        { id: 'site-1', name: 'Main site' },
        { id: 'site-2', name: 'Second site' },
      ],
    },
    isLoading: false,
  });
  settingsUseQueryMock.mockReturnValue({
    data: {
      schemaVersion: 1,
      pucDefaultsVersion: 1,
      accounts: pucAccounts,
      defaults: pucAccounts,
      lastSiteId: 'site-2',
    },
    isLoading: false,
    error: null,
  });
  accountingUseQueryMock.mockReturnValue({
    data: { vouchers: [], truncated: false },
    error: null,
    isLoading: false,
  });
});

describe('AccountingExportPage date range', () => {
  it('disables the accounting request and exports while the range is invalid', async () => {
    render(<AccountingExportPage />);
    await waitFor(() => {
      expect(accountingUseQueryMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ siteId: 'site-2' }),
        expect.objectContaining({ enabled: true })
      );
    });

    fireEvent.change(screen.getByLabelText(/^(From|Desde)$/), {
      target: { value: '9999-12-31' },
    });

    expect(accountingUseQueryMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );
    expect(screen.getByTestId('accounting-invalid-range')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('accounting-export-journal')).toBeDisabled();
    expect(screen.getByTestId('accounting-export-generic')).toBeDisabled();
  });

  it('hydrates and persists the last tenant site without issuing an enabled all-sites request', async () => {
    render(<AccountingExportPage />);

    await waitFor(() => {
      expect(screen.getByTestId('accounting-site-filter')).toHaveValue('site-2');
    });
    const enabledCalls = accountingUseQueryMock.mock.calls.filter(
      call => (call[1] as { enabled?: boolean }).enabled
    );
    expect(enabledCalls.every(call => (call[0] as { siteId?: string }).siteId === 'site-2')).toBe(
      true
    );

    fireEvent.change(screen.getByTestId('accounting-site-filter'), {
      target: { value: 'site-1' },
    });
    expect(rememberSiteResetMock).toHaveBeenCalledOnce();
    expect(rememberSiteMutateMock).toHaveBeenCalledWith({ siteId: 'site-1' });
  });

  it('submits validated PUC account edits', async () => {
    render(<AccountingExportPage />);
    fireEvent.click(screen.getByText(/PUC account configuration|Configuración de cuentas PUC/));

    const income = await screen.findByLabelText(/Sales income|Ingreso por ventas/);
    fireEvent.change(income, { target: { value: '413596' } });
    fireEvent.click(screen.getByTestId('accounting-save-puc'));

    expect(updateAccountsMutateMock).toHaveBeenCalledWith({
      ...pucAccounts,
      income: '413596',
    });
  });

  it('rejects a zero-prefixed PUC account before submitting', async () => {
    render(<AccountingExportPage />);
    fireEvent.click(screen.getByText(/PUC account configuration|Configuración de cuentas PUC/));

    fireEvent.change(await screen.findByLabelText(/Sales income|Ingreso por ventas/), {
      target: { value: '0000' },
    });

    expect(screen.getByTestId('accounting-save-puc')).toBeDisabled();
    expect(updateAccountsMutateMock).not.toHaveBeenCalled();
  });

  it('surfaces a site loading failure while keeping accounting requests disabled', () => {
    sitesUseQueryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('db') });
    render(<AccountingExportPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Sites could not be loaded|No se pudieron cargar las sedes/
    );
    expect(accountingUseQueryMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );
  });
});
