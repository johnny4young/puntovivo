/**
 * CustomersPage column-trim + row-detail integration.
 *
 * The first test for this page. Renders with the REAL ResourcePage /
 * DataTable + CustomerDetailsDrawer (only the heavy form / confirm /
 * ledger modals are stubbed) to prove:
 * - the default table renders the smallest useful column set — email,
 * phone, type and location headers are gone;
 * - the Details (eye) action opens the row-detail Drawer, which surfaces
 * exactly those trimmed fields.
 *
 * @module features/customers/CustomersPage.test
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { disposePersonalDataMock, exportPersonalDataMock, useAuthMock } = vi.hoisted(() => ({
  disposePersonalDataMock: vi.fn(),
  exportPersonalDataMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// Stub only the heavy modals; ResourcePage / DataTable + CustomerDetailsDrawer
// stay REAL so the column set and the drawer round-trip are exercised.
vi.mock('@/features/customers/CustomerFormModal', () => ({ CustomerFormModal: () => null }));
vi.mock('@/features/customers/CustomerLedgerModal', () => ({ CustomerLedgerModal: () => null }));

// vi.hoisted so the (hoisted) vi.mock factory can reference these without a
// temporal-dead-zone error — `emptyList` is read eagerly as a property value.
const { customer, emptyList, listQueryInputs } = vi.hoisted(() => ({
  // every `customers.list` input the page issued, in order.
  listQueryInputs: [] as unknown[],
  customer: {
    id: 'c-1',
    version: 0,
    name: 'Comercializadora Andina',
    email: 'ventas@andina.co',
    phone: '+57 300 111 2233',
    clientTypeId: 'mayorista',
    identificationTypeId: 'NIT',
    taxId: '900123456',
    city: 'Bogotá',
    state: 'Cundinamarca',
    country: 'Colombia',
    isActive: true,
  },
  emptyList: { useQuery: () => ({ data: { items: [] } }) },
}));

// the row-detail drawer now hosts the loyalty panel. This suite
// pins the page's column set and drawer wiring, not loyalty; the panel has
// its own suite in CustomerLoyaltyPanel.test.tsx.
vi.mock('@/features/customers/CustomerLoyaltyPanel', () => ({
  CustomerLoyaltyPanel: () => null,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ customers: { list: { invalidate: vi.fn() } } }),
    customers: {
      list: {
        useQuery: (input: unknown) => {
          listQueryInputs.push(input);
          const search = (input as { search?: string }).search;
          return {
            data: { items: search === 'missing' ? [] : [customer] },
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          };
        },
      },
      create: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      delete: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      previewPersonalDataDisposition: {
        useQuery: () => ({
          data: {
            customer: {
              id: customer.id,
              name: customer.name,
              version: customer.version,
              privacyStatus: 'active',
            },
            disposition: 'delete',
            linkedRecordCounts: {
              sales: 0,
              quotations: 0,
              ledgerEntries: 0,
              deliveryOrders: 0,
              fiscalDocuments: 0,
            },
            totalLinkedRecords: 0,
            retentionReason: null,
          },
          isLoading: false,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      disposePersonalData: {
        useMutation: () => ({
          mutateAsync: disposePersonalDataMock,
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      exportPersonalData: {
        useMutation: () => ({
          mutateAsync: exportPersonalDataMock,
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
    identificationTypes: { list: emptyList },
    personTypes: { list: emptyList },
    regimeTypes: { list: emptyList },
    clientTypes: { list: emptyList },
    commercialActivities: { list: emptyList },
  },
}));

import { CustomersPage } from './CustomersPage';

describe('CustomersPage default column set', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    disposePersonalDataMock.mockReset();
    disposePersonalDataMock.mockResolvedValue(undefined);
    exportPersonalDataMock.mockReset();
    exportPersonalDataMock.mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'admin' } });
  });

  it('renders the smallest useful column set (email / phone / type / location trimmed)', () => {
    render(<CustomersPage />);

    // Core columns stay.
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();

    // Trimmed columns are gone from the default table.
    expect(screen.queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Phone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Location' })).not.toBeInTheDocument();
  });

  it('opens the row-detail Drawer with the trimmed fields when Details is clicked', () => {
    render(<CustomersPage />);

    expect(screen.queryByTestId('customer-details-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view details|ver detalle/i }));

    const drawer = screen.getByTestId('customer-details-drawer');
    expect(drawer).toBeInTheDocument();
    // Trimmed fields surface inside the drawer.
    expect(within(drawer).getByText('ventas@andina.co')).toBeInTheDocument();
    expect(within(drawer).getByText('+57 300 111 2233')).toBeInTheDocument();
    expect(within(drawer).getByText('Bogotá, Cundinamarca')).toBeInTheDocument();
  });

  it('offers customer privacy actions only to admins', () => {
    const { unmount } = render(<CustomersPage />);
    expect(screen.getByRole('button', { name: 'Delete personal data' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /view details|ver detalle/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /export personal data|exportar datos personales/i })
    );
    expect(exportPersonalDataMock).toHaveBeenCalledWith({ id: 'c-1' });

    unmount();
    useAuthMock.mockReturnValue({ user: { id: 'u-2', role: 'manager' } });
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole('button', { name: /view details|ver detalle/i }));
    expect(
      screen.queryByRole('button', { name: /export personal data|exportar datos personales/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete personal data' })).not.toBeInTheDocument();
  });

  it('requires the exact previewed customer name before disposing personal data', () => {
    render(<CustomersPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete personal data' }));
    expect(screen.getByRole('heading', { name: 'Delete customer data' })).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Delete permanently' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirmation'), {
      target: { value: customer.name },
    });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(disposePersonalDataMock).toHaveBeenCalledWith({
      id: customer.id,
      version: customer.version,
      confirmation: customer.name,
    });
  });
});

/**
 * the search box delegates to the server.
 *
 * The page loads one 50-row page, so the old client-side column filter
 * reported "no results" for any customer past row 50 — people who exist and
 * whom the cashier can see on the next page. These pin that the term now
 * leaves the browser, and that the table stopped filtering locally.
 */
describe('CustomersPage server-side search', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'admin' } });
    listQueryInputs.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the typed term to the server, debounced', async () => {
    render(<CustomersPage />);

    // The first render asks for the unsearched page: no `search` key at all,
    // so it shares the cache entry with a plain visit.
    expect(listQueryInputs[0]).toEqual({ page: 1, perPage: 50 });

    fireEvent.change(screen.getByTestId('data-table-search'), { target: { value: 'rosa' } });

    // Nothing yet — a keystroke must not be a request.
    expect(listQueryInputs.some(i => (i as { search?: string }).search === 'rosa')).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(listQueryInputs.at(-1)).toEqual({ page: 1, perPage: 50, search: 'rosa' });
  });

  it('does not filter the returned rows locally', async () => {
    render(<CustomersPage />);

    // The server owns matching (it searches name, email AND phone). A row it
    // returned must render even when the term matches none of the columns the
    // old `searchKey="name"` filter looked at — otherwise a phone-number
    // search would come back empty.
    fireEvent.change(screen.getByTestId('data-table-search'), { target: { value: '300 111' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByText('Comercializadora Andina')).toBeInTheDocument();
  });

  it('does not mistake an empty search result for a fresh tenant', async () => {
    render(<CustomersPage />);

    fireEvent.change(screen.getByTestId('data-table-search'), { target: { value: 'missing' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByTestId('empty-state-readiness-customers')).not.toBeInTheDocument();
  });
});
