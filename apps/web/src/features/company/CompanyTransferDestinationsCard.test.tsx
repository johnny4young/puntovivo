import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const setMutate = vi.fn();
const reorderMutate = vi.fn();
const removeMutate = vi.fn();
const invalidateList = vi.fn(async () => undefined);
const invalidateForCharge = vi.fn(async () => undefined);
const setListData = vi.fn();

interface Row {
  id: string;
  position: number;
  kind: 'bre_b' | 'nequi' | 'daviplata' | 'bank_account';
  label: string;
  account: string;
  bankName: string | null;
  accountType: 'savings' | 'checking' | null;
  holderName: string | null;
  holderId: string | null;
  qrPayload: string | null;
}

const row = (id: string, position: number, fields: Partial<Row> = {}): Row => ({
  id,
  position,
  kind: 'nequi',
  label: 'Nequi',
  account: `300123456${position}`,
  bankName: null,
  accountType: null,
  holderName: null,
  holderId: null,
  qrPayload: null,
  ...fields,
});

const baseRows: Row[] = [
  row('d1', 0, { kind: 'bre_b', label: 'Bre-B', account: '@tienda', qrPayload: '000201' }),
  row('d2', 1, { account: '3001234567' }),
  row('d3', 2, {
    kind: 'bank_account',
    label: 'Caja principal',
    account: '12345678',
    bankName: 'Bancolombia',
    accountType: 'savings',
  }),
];

let rows: Row[] = baseRows;
let role = 'admin';
let sites = [{ id: 'site-1', name: 'Centro' }];
const listUseQuery = vi.fn((_input: { siteId: string }, _options: { enabled: boolean }) => ({
  data: rows,
  isLoading: false,
  isSuccess: true,
  error: null,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', role } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ sites, currentSite: sites[0] }),
}));

type MutationOptions = { onSuccess?: (data: Row[], input: { siteId: string }) => void };
function mutation(spy: (input: { siteId: string }) => void) {
  return {
    useMutation: (options: MutationOptions) => ({
      mutate: (input: { siteId: string }) => {
        spy(input);
        options.onSuccess?.(rows, input);
      },
      isPending: false,
    }),
  };
}

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      transferDestinations: {
        list: { invalidate: invalidateList, setData: setListData },
        forCharge: { invalidate: invalidateForCharge },
      },
    }),
    transferDestinations: {
      list: { useQuery: (...args: Parameters<typeof listUseQuery>) => listUseQuery(...args) },
      set: mutation(input => setMutate(input)),
      reorder: mutation(input => reorderMutate(input)),
      remove: mutation(input => removeMutate(input)),
    },
  },
}));

import { CompanyTransferDestinationsCard } from './CompanyTransferDestinationsCard';

const change = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('CompanyTransferDestinationsCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    rows = baseRows;
    role = 'admin';
    sites = [{ id: 'site-1', name: 'Centro' }];
    await i18n.changeLanguage('en');
  });

  it('lists each destination with its kind, label, account and stored-QR badge', () => {
    render(<CompanyTransferDestinationsCard />);
    expect(screen.getByTestId('transfer-destinations-row-d1')).toHaveTextContent('Bre-B');
    expect(screen.getByTestId('transfer-destinations-qr-d1')).toHaveTextContent('Bank QR stored');
    expect(screen.getByTestId('transfer-destinations-row-d2')).toHaveTextContent('300 123 4567');
    expect(screen.queryByTestId('transfer-destinations-qr-d2')).not.toBeInTheDocument();
    const bank = screen.getByTestId('transfer-destinations-row-d3');
    expect(bank).toHaveTextContent('Bancolombia · Savings');
    expect(bank).toHaveTextContent('Caja principal');
    expect(listUseQuery).toHaveBeenCalledWith({ siteId: 'site-1' }, { enabled: true });
    expect(screen.queryByTestId('transfer-destinations-site')).not.toBeInTheDocument();
  });

  it('shows the empty state with an enabled add button', () => {
    rows = [];
    render(<CompanyTransferDestinationsCard />);
    expect(screen.getByTestId('transfer-destinations-empty')).toHaveTextContent(
      'This site has no transfer destinations.'
    );
    expect(screen.getByTestId('transfer-destinations-add')).toBeEnabled();
  });

  it('renders nothing and skips the query for a non-admin', () => {
    role = 'manager';
    const { container } = render(<CompanyTransferDestinationsCard />);
    expect(container).toBeEmptyDOMElement();
    expect(listUseQuery).toHaveBeenCalledWith({ siteId: 'site-1' }, { enabled: false });
  });

  it('reads the picked site when the tenant has several', () => {
    sites = [
      { id: 'site-1', name: 'Centro' },
      { id: 'site-2', name: 'Norte' },
    ];
    render(<CompanyTransferDestinationsCard />);
    change('transfer-destinations-site', 'site-2');
    expect(listUseQuery).toHaveBeenLastCalledWith({ siteId: 'site-2' }, { enabled: true });
  });

  it('blocks save while the account is not valid for the kind', () => {
    render(<CompanyTransferDestinationsCard />);
    fireEvent.click(screen.getByTestId('transfer-destinations-add'));
    change('transfer-destinations-kind', 'nequi');
    change('transfer-destinations-account', '12345');
    expect(screen.getByTestId('transfer-destinations-account-error')).toHaveTextContent(
      /10-digit mobile number/
    );
    fireEvent.click(screen.getByTestId('transfer-destinations-save'));
    expect(setMutate).not.toHaveBeenCalled();
  });

  it('blocks save while the bank QR is not a complete payload', () => {
    render(<CompanyTransferDestinationsCard />);
    fireEvent.click(screen.getByTestId('transfer-destinations-add'));
    change('transfer-destinations-account', '@nueva');
    change('transfer-destinations-qr-payload', 'not-a-qr');
    expect(screen.getByTestId('transfer-destinations-qrPayload-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('transfer-destinations-save'));
    expect(setMutate).not.toHaveBeenCalled();
  });

  it('creates a destination with the normalized account, stores the list and refreshes the register read', () => {
    render(<CompanyTransferDestinationsCard />);
    fireEvent.click(screen.getByTestId('transfer-destinations-add'));
    change('transfer-destinations-kind', 'nequi');
    change('transfer-destinations-account', '+57 300 765 4321');
    change('transfer-destinations-holder-name', ' Tienda SAS ');
    fireEvent.click(screen.getByTestId('transfer-destinations-save'));
    expect(setMutate).toHaveBeenCalledWith({
      siteId: 'site-1',
      kind: 'nequi',
      label: null,
      account: '3007654321',
      bankName: null,
      accountType: null,
      holderName: 'Tienda SAS',
      holderId: null,
      qrPayload: null,
    });
    expect(setListData).toHaveBeenCalledWith({ siteId: expect.any(String) }, expect.any(Array));
    expect(invalidateList).not.toHaveBeenCalled();
    expect(invalidateForCharge).toHaveBeenCalled();
    expect(screen.queryByTestId('transfer-destinations-form')).not.toBeInTheDocument();
  });

  it('requires the bank name and account type for a bank account', () => {
    render(<CompanyTransferDestinationsCard />);
    fireEvent.click(screen.getByTestId('transfer-destinations-add'));
    change('transfer-destinations-kind', 'bank_account');
    change('transfer-destinations-account', '1234-5678');
    fireEvent.click(screen.getByTestId('transfer-destinations-save'));
    expect(screen.getByTestId('transfer-destinations-bankName-error')).toBeInTheDocument();
    expect(screen.getByTestId('transfer-destinations-accountType-error')).toBeInTheDocument();
    expect(setMutate).not.toHaveBeenCalled();

    change('transfer-destinations-bank-name', 'Davivienda');
    change('transfer-destinations-account-type', 'checking');
    fireEvent.click(screen.getByTestId('transfer-destinations-save'));
    expect(setMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bank_account',
        account: '12345678',
        bankName: 'Davivienda',
        accountType: 'checking',
      })
    );
  });

  it('edits a destination by id, keeping its stored fields', () => {
    render(<CompanyTransferDestinationsCard />);
    fireEvent.click(screen.getByTestId('transfer-destinations-edit-d3'));
    expect(screen.getByTestId('transfer-destinations-label')).toHaveValue('Caja principal');
    change('transfer-destinations-label', '');
    fireEvent.click(screen.getByTestId('transfer-destinations-save'));
    expect(setMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'd3',
        label: null,
        account: '12345678',
        bankName: 'Bancolombia',
        accountType: 'savings',
      })
    );
  });

  it('sends the full id list when a destination moves', () => {
    render(<CompanyTransferDestinationsCard />);
    expect(screen.getByTestId('transfer-destinations-up-d1')).toBeDisabled();
    expect(screen.getByTestId('transfer-destinations-down-d3')).toBeDisabled();
    fireEvent.click(screen.getByTestId('transfer-destinations-down-d1'));
    expect(reorderMutate).toHaveBeenCalledWith({ siteId: 'site-1', ids: ['d2', 'd1', 'd3'] });
    fireEvent.click(screen.getByTestId('transfer-destinations-up-d3'));
    expect(reorderMutate).toHaveBeenLastCalledWith({ siteId: 'site-1', ids: ['d1', 'd3', 'd2'] });
  });

  it('removes a destination only after the confirm step', () => {
    render(<CompanyTransferDestinationsCard />);
    fireEvent.click(screen.getByTestId('transfer-destinations-remove-d2'));
    expect(removeMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removeMutate).toHaveBeenCalledWith({ siteId: 'site-1', id: 'd2' });
    expect(invalidateForCharge).toHaveBeenCalled();
  });

  it('disables add once the site has the maximum', () => {
    rows = Array.from({ length: 6 }, (_, index) => row(`d${index}`, index));
    render(<CompanyTransferDestinationsCard />);
    expect(screen.getByTestId('transfer-destinations-add')).toBeDisabled();
    expect(screen.getByTestId('transfer-destinations-count')).toHaveTextContent('6 of 6');
  });
});
