/**
 * CustomerLedgerModal smoke tests.
 *
 * Mocks the trpc client + auth so the render assertions stay
 * deterministic. Covers:
 * - empty state when the customer has no ledger entries
 * - populated ledger renders kinds + amounts
 * - balance metric flips to the danger tone when > 0 (customer owes)
 * - cupo + projected balance behave correctly per `creditLimit`
 * - role gating: cashier never reaches this surface; manager sees
 * Cargar a cuenta disabled; admin sees it enabled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { fireEvent, render, screen } from '@/test/utils';
import type { Customer } from '@/types';
import { CustomerLedgerModal } from '../CustomerLedgerModal';

const exportToCSVMock = vi.hoisted(() => vi.fn());

let mockRole: 'admin' | 'manager' = 'admin';
let mockLedgerRows: Array<{
  id: string;
  occurredAt: string;
  kind: 'sale' | 'payment' | 'adjustment';
  amount: number;
  note: string | null;
  referenceSaleId: string | null;
}> = [];
let mockBalance = 0;

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      tenantId: 'tenant-1',
      role: mockRole,
    },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/services/export/exportService', () => ({
  exportToCSV: exportToCSVMock,
  // CustomerLedgerModal now imports buildSemanticFilename to
  // resolve the canonical ledger-statement filename pattern; the test
  // does not care about the exact name (it only verifies the export
  // helper was invoked) so a passthrough constant is enough.
  buildSemanticFilename: () => 'ledger-estadocuenta-test.csv',
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      customerLedger: {
        list: { invalidate: vi.fn(async () => undefined) },
        getBalance: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    customerLedger: {
      list: {
        useQuery: () => ({
          data: mockLedgerRows,
          isLoading: false,
          error: null,
        }),
      },
      getBalance: {
        useQuery: () => ({
          data: { balance: mockBalance },
          isLoading: false,
          error: null,
        }),
      },
      addPayment: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
        }),
      },
      addAdjustment: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-1',
    tenantId: 'tenant-1',
    name: 'Sra. Rosa',
    taxId: '123-4',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Customer;
}

describe('CustomerLedgerModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
    mockRole = 'admin';
    mockLedgerRows = [];
    mockBalance = 0;
    exportToCSVMock.mockClear();
  });

  it('renders the empty state when the customer has no ledger entries', () => {
    render(<CustomerLedgerModal isOpen customer={makeCustomer()} onClose={vi.fn()} />);
    expect(screen.getByTestId('ledger-empty')).toBeInTheDocument();
    // Estado cuenta button is disabled because there is nothing to
    // export.
    expect(screen.getByTestId('ledger-cta-estado-cuenta')).toBeDisabled();
  });

  it('renders ledger rows with localized kind labels', () => {
    mockLedgerRows = [
      {
        id: 'r1',
        occurredAt: '2026-05-15T10:00:00Z',
        kind: 'payment',
        amount: -50,
        note: 'Abono efectivo',
        referenceSaleId: null,
      },
      {
        id: 'r2',
        occurredAt: '2026-05-10T10:00:00Z',
        kind: 'sale',
        amount: 100,
        note: null,
        referenceSaleId: 'sale-1',
      },
    ];
    render(<CustomerLedgerModal isOpen customer={makeCustomer()} onClose={vi.fn()} />);
    expect(screen.getByText('Payment')).toBeInTheDocument();
    expect(screen.getByText('Credit sale')).toBeInTheDocument();
  });

  it('exports the statement with a human-readable CSV filename', () => {
    mockLedgerRows = [
      {
        id: 'r1',
        occurredAt: '2026-05-15T10:00:00Z',
        kind: 'payment',
        amount: -50,
        note: 'Abono efectivo',
        referenceSaleId: null,
      },
    ];
    render(
      <CustomerLedgerModal
        isOpen
        customer={makeCustomer({
          name: 'Juan Pérez S.A.S.',
          taxId: 'NIT 900.123.456-7',
        })}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('ledger-cta-estado-cuenta'));

    // `CustomerLedgerModal` now resolves the filename via
    // the centralized `buildSemanticFilename` helper (mocked above to
    // a deterministic string). The component strips the `.csv`
    // extension before invoking `exportToCSV` (which appends it
    // again), so the mock receives the stem.
    expect(exportToCSVMock).toHaveBeenCalledWith(
      mockLedgerRows,
      expect.any(Array),
      'ledger-estadocuenta-test',
      { includeTimestamp: false }
    );
  });

  it('flips the balance pill to the danger tone when the customer owes money', () => {
    mockBalance = 150;
    render(<CustomerLedgerModal isOpen customer={makeCustomer()} onClose={vi.fn()} />);
    const balanceCell = screen.getByTestId('ledger-metric-balance');
    expect(balanceCell.className).toMatch(/danger/);
  });

  it('renders Sin cupo when creditLimit is 0', () => {
    render(
      <CustomerLedgerModal isOpen customer={makeCustomer({ creditLimit: 0 })} onClose={vi.fn()} />
    );
    expect(screen.getByTestId('ledger-metric-cupo')).toHaveTextContent('No limit');
  });

  it('flips the projected pill to the warning tone when balance exceeds cupo', () => {
    mockBalance = 300;
    render(
      <CustomerLedgerModal isOpen customer={makeCustomer({ creditLimit: 200 })} onClose={vi.fn()} />
    );
    const projected = screen.getByTestId('ledger-metric-projected');
    expect(projected.className).toMatch(/warning/);
  });

  it('enables Cargar a cuenta for admin users', () => {
    mockRole = 'admin';
    render(<CustomerLedgerModal isOpen customer={makeCustomer()} onClose={vi.fn()} />);
    const cta = screen.getByTestId('ledger-cta-cargar-cuenta');
    expect(cta).not.toBeDisabled();
  });

  it('disables Cargar a cuenta for manager users (admin-only gate)', () => {
    mockRole = 'manager';
    render(<CustomerLedgerModal isOpen customer={makeCustomer()} onClose={vi.fn()} />);
    const cta = screen.getByTestId('ledger-cta-cargar-cuenta');
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('title', expect.stringMatching(/Admin/i));
  });

  it('keeps the ledger panel open when Escape closes the abono modal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CustomerLedgerModal isOpen customer={makeCustomer()} onClose={onClose} />);

    await user.click(screen.getByTestId('ledger-cta-abono'));
    expect(screen.getByRole('heading', { name: 'Receive payment' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('heading', { name: 'Receive payment' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account statement' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
