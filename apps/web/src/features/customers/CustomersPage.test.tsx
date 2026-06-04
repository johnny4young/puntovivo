/**
 * ENG-132b — CustomersPage column-trim + row-detail integration.
 *
 * The first test for this page. Renders with the REAL ResourcePage /
 * DataTable + CustomerDetailsDrawer (only the heavy form / confirm /
 * ledger modals are stubbed) to prove:
 *   - the default table renders the smallest useful column set — email,
 *     phone, type and location headers are gone;
 *   - the Details (eye) action opens the row-detail Drawer, which surfaces
 *     exactly those trimmed fields.
 *
 * @module features/customers/CustomersPage.test
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// Stub only the heavy modals; ResourcePage / DataTable + CustomerDetailsDrawer
// stay REAL so the column set and the drawer round-trip are exercised.
vi.mock('@/features/customers/CustomerFormModal', () => ({ CustomerFormModal: () => null }));
vi.mock('@/features/customers/CustomerLedgerModal', () => ({ CustomerLedgerModal: () => null }));
vi.mock('@/components/form-controls/Modal', () => ({ ConfirmModal: () => null }));

// vi.hoisted so the (hoisted) vi.mock factory can reference these without a
// temporal-dead-zone error — `emptyList` is read eagerly as a property value.
const { customer, emptyList } = vi.hoisted(() => ({
  customer: {
    id: 'c-1',
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

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ customers: { list: { invalidate: vi.fn() } } }),
    customers: {
      list: {
        useQuery: () => ({
          data: { items: [customer] },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
      update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
      delete: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null, reset: vi.fn() }) },
    },
    identificationTypes: { list: emptyList },
    personTypes: { list: emptyList },
    regimeTypes: { list: emptyList },
    clientTypes: { list: emptyList },
    commercialActivities: { list: emptyList },
  },
}));

import { CustomersPage } from './CustomersPage';

describe('CustomersPage default column set (ENG-132b)', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
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
});
