/**
 * ENG-065b — Tests for InventoryHealthPanel.
 *
 * Asserts:
 *   - Loading copy renders while the query resolves.
 *   - Empty state renders when no drift rows.
 *   - Drift rows render with delta sign + sku + cached/sum values.
 *   - Admin reconcile click fires the inventory.reconcileBalances mutation.
 *   - Manager sees the button disabled with translated tooltip.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
import { InventoryHealthPanel } from './InventoryHealthPanel';

const reconcileMutate = vi.fn(async () => ({ productsUpdated: 0, reconciledAt: '' }));
const inventoryDiscrepanciesInvalidate = vi.fn(async () => undefined);
let mockUserRole: 'admin' | 'manager' = 'admin';

interface MockData {
  summary: {
    productsScanned: number;
    discrepancyCount: number;
    deltaEpsilon: number;
  };
  rows: Array<Record<string, unknown>>;
}

let mockData: MockData | null = null;
let mockLoading = false;
let mockError: { message: string } | null = null;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      reports: {
        inventory: { discrepancies: { invalidate: inventoryDiscrepanciesInvalidate } },
      },
    }),
    reports: {
      inventory: {
        discrepancies: {
          useQuery: () => ({
            data: mockData,
            isLoading: mockLoading,
            error: mockError,
          }),
        },
      },
    },
    inventory: {
      reconcileBalances: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: reconcileMutate,
        }),
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'demo@test', role: mockUserRole, tenantId: 't1' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

beforeEach(() => {
  reconcileMutate.mockClear();
  inventoryDiscrepanciesInvalidate.mockClear();
  mockUserRole = 'admin';
  mockData = null;
  mockLoading = false;
  mockError = null;
});

function makeData(rows: Array<Record<string, unknown>> = []): MockData {
  return {
    summary: {
      productsScanned: rows.length === 0 ? 5 : 5,
      discrepancyCount: rows.length,
      deltaEpsilon: 0.001,
    },
    rows,
  };
}

describe('InventoryHealthPanel', () => {
  it('renders the loading copy while the query resolves', () => {
    mockLoading = true;
    render(<InventoryHealthPanel />);
    expect(screen.getByText(/Cargando|Loading/i)).toBeInTheDocument();
  });

  it('renders the empty state when no drift rows', () => {
    mockData = makeData([]);
    render(<InventoryHealthPanel />);
    expect(
      screen.getByText(/El inventario está consistente|Inventory is consistent/i)
    ).toBeInTheDocument();
  });

  it('renders drift rows with sign-coded delta', () => {
    mockData = makeData([
      {
        productId: 'p-1',
        productName: 'Leche entera 1L',
        productSku: 'LE-1L',
        cachedStock: 20,
        sumOfBalances: 10,
        delta: 10,
        siteCount: 2,
      },
      {
        productId: 'p-2',
        productName: 'Pan tajado',
        productSku: null,
        cachedStock: 4,
        sumOfBalances: 8,
        delta: -4,
        siteCount: 2,
      },
    ]);
    render(<InventoryHealthPanel />);
    expect(screen.getByText('Leche entera 1L')).toBeInTheDocument();
    expect(screen.getByText('Pan tajado')).toBeInTheDocument();
    expect(screen.getByText('LE-1L')).toBeInTheDocument();
    // Positive delta shows leading +; negative without.
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getByText('-4')).toBeInTheDocument();
  });

  it('fires the admin reconcile mutation on click', () => {
    mockData = makeData([
      {
        productId: 'p-3',
        productName: 'Producto drift',
        productSku: 'D-1',
        cachedStock: 5,
        sumOfBalances: 0,
        delta: 5,
        siteCount: 1,
      },
    ]);
    render(<InventoryHealthPanel />);
    const cta = screen.getByTestId('inventory-reconcile-cta');
    expect(cta).not.toBeDisabled();
    fireEvent.click(cta);
    expect(reconcileMutate).toHaveBeenCalledTimes(1);
  });

  it('disables the reconcile button for manager role with translated tooltip', () => {
    mockUserRole = 'manager';
    mockData = makeData([
      {
        productId: 'p-4',
        productName: 'Producto drift mgr',
        productSku: 'D-2',
        cachedStock: 5,
        sumOfBalances: 0,
        delta: 5,
        siteCount: 1,
      },
    ]);
    render(<InventoryHealthPanel />);
    const cta = screen.getByTestId('inventory-reconcile-cta');
    expect(cta).toBeDisabled();
    expect(cta.getAttribute('title')).toMatch(/admin/i);
  });
});
