import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { InventoryBalancesBySiteResult } from '@/types';
import {
  InventoryBalancesPanel,
  type InventoryBalancesPanelSite,
} from './InventoryBalancesPanel';

type BalancesQueryResult = {
  data: InventoryBalancesBySiteResult | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};

let balancesQueryResult: BalancesQueryResult;
const balancesQuerySpy = vi.fn();

const transferMutationState = {
  mutateAsync: vi.fn(async () => undefined),
  reset: vi.fn(),
  isPending: false,
  error: null as Error | null,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      inventory: { listBalancesBySite: { invalidate: vi.fn(async () => undefined) } },
      transfers: { list: { invalidate: vi.fn(async () => undefined) } },
    }),
    inventory: {
      listBalancesBySite: {
        useQuery: (input: { siteId: string }) => {
          balancesQuerySpy(input);
          return balancesQueryResult;
        },
      },
    },
    transfers: {
      create: {
        useMutation: (_opts: unknown) => transferMutationState,
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const primarySite: InventoryBalancesPanelSite = {
  id: 'site-primary',
  name: 'Main Site',
  isActive: true,
};

const secondarySite: InventoryBalancesPanelSite = {
  id: 'site-secondary',
  name: 'Warehouse',
  isActive: true,
};

const inactiveSite: InventoryBalancesPanelSite = {
  id: 'site-inactive',
  name: 'Inactive Site',
  isActive: false,
};

const primaryBalances: InventoryBalancesBySiteResult = {
  siteId: primarySite.id,
  items: [
    {
      id: 'balance-1',
      tenantId: 'tenant-1',
      siteId: primarySite.id,
      productId: 'product-1',
      productName: 'Cable 2.5m',
      productSku: 'CABLE-25',
      onHand: 12.5,
      reserved: 0,
      available: 12.5,
      minStock: 2,
      isLowStock: false,
      updatedAt: new Date().toISOString(),
    },
  ],
  summary: {
    totalOnHand: 12.5,
    totalReserved: 0,
    totalAvailable: 12.5,
    lowStockCount: 0,
    productsTracked: 1,
  },
};

function setBalancesResult(partial?: Partial<BalancesQueryResult>): void {
  balancesQueryResult = {
    data: primaryBalances,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...partial,
  };
}

describe('InventoryBalancesPanel', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders balance rows and summary totals for the selected site', () => {
    setBalancesResult();
    render(
      <InventoryBalancesPanel
        sites={[primarySite, secondarySite]}
        sitesLoading={false}
      />
    );

    expect(screen.getByText('Cable 2.5m')).toBeInTheDocument();
    expect(screen.getByText('CABLE-25')).toBeInTheDocument();
    expect(screen.getAllByText('12.5').length).toBeGreaterThan(0);
    expect(screen.getByText('Total on hand')).toBeInTheDocument();
  });

  it('shows a fallback message when no active sites are configured', () => {
    setBalancesResult();
    render(<InventoryBalancesPanel sites={[inactiveSite]} sitesLoading={false} />);

    expect(
      screen.getByText('No active sites yet. Create one to start tracking per-site stock.')
    ).toBeInTheDocument();
  });

  it('drives tRPC with the newly chosen site when the selector changes', async () => {
    setBalancesResult();
    balancesQuerySpy.mockClear();

    render(
      <InventoryBalancesPanel
        sites={[primarySite, secondarySite]}
        sitesLoading={false}
      />
    );

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Site'), secondarySite.id);

    const lastCall = balancesQuerySpy.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({ siteId: secondarySite.id });
  });

  it('disables the Transfer stock button until two active sites exist', () => {
    setBalancesResult();

    const { rerender } = render(
      <InventoryBalancesPanel sites={[primarySite]} sitesLoading={false} />
    );

    const singleSiteButton = screen.getByRole('button', { name: /Transfer stock/i });
    expect(singleSiteButton).toBeDisabled();

    rerender(
      <InventoryBalancesPanel
        sites={[primarySite, secondarySite]}
        sitesLoading={false}
      />
    );

    const twoSiteButton = screen.getByRole('button', { name: /Transfer stock/i });
    expect(twoSiteButton).not.toBeDisabled();
  });

  it('opens the transfer modal and blocks submission when required fields are missing', async () => {
    setBalancesResult();
    transferMutationState.mutateAsync.mockClear();

    render(
      <InventoryBalancesPanel
        sites={[primarySite, secondarySite]}
        sitesLoading={false}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Transfer stock/i }));

    const submitButton = await screen.findByRole('button', { name: 'Transfer' });
    expect(submitButton).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'From site' })).toBeDisabled();

    expect(screen.getByText('Transfer stock between sites')).toBeInTheDocument();
    expect(transferMutationState.mutateAsync).not.toHaveBeenCalled();
  });
});
