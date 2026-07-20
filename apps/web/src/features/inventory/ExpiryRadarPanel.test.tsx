/**
 * ExpiryRadarPanel render + interaction contract.
 *
 * The panel merges two mocked reads (expiring lots + active suggestions),
 * prices the risk per row (on hand × unit cost) and in the summary strip,
 * and drives the two mutations from the action column. The tier preview and
 * urgency tones are asserted through the row chips.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { ExpiryRadarPanel } from './ExpiryRadarPanel';

interface MockLot {
  id: string;
  siteId: string;
  productId: string;
  lotNumber: string;
  expiresAt: string | null;
  onHand: number;
  unitCost: number;
  status: string;
  receivedAt: string;
  productName: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY_MS).toISOString();

let mockExpiring: {
  data?: { items: MockLot[]; cutoff: string };
  isLoading: boolean;
  error: { message: string } | null;
};
let mockSuggestions: {
  data?: {
    items: Array<{
      id: string;
      productId: string;
      lotId: string;
      lotNumber: string;
      discountPct: number;
      lotExpiresAt: string | null;
      productName: string;
    }>;
  };
  isLoading: boolean;
  error: null;
};
const suggestMutate = vi.fn();
const dismissMutate = vi.fn();
/** Every `expiring.useQuery` input, newest last ( window assertions). */
const expiringQueryInputs: Array<{ withinDays: number }> = [];

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      inventoryLots: {
        activeSuggestions: { invalidate: vi.fn(async () => undefined) },
        expiring: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    inventoryLots: {
      expiring: {
        // record the input so the window-selector test can assert
        // the query actually re-runs with the picked sweep.
        useQuery: (input: { withinDays: number }) => {
          expiringQueryInputs.push(input);
          return mockExpiring;
        },
      },
      activeSuggestions: { useQuery: () => mockSuggestions },
      suggestDiscount: {
        useMutation: () => ({ mutate: suggestMutate, isPending: false }),
      },
      dismissSuggestion: {
        useMutation: () => ({ mutate: dismissMutate, isPending: false }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// the panel previews the percent from the tenant's tuned ladder
// (auth.me session payload). Default to an untuned tenant so the existing
// assertions keep exercising the  fallback ladder.
let mockTenantSettings: { discount?: { expiryTiers: Array<{ maxDays: number; pct: number }> } } =
  {};
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ tenantSettings: mockTenantSettings }),
}));

function makeLot(overrides: Partial<MockLot>): MockLot {
  return {
    id: 'lot-1',
    siteId: 'site-1',
    productId: 'p-1',
    lotNumber: 'L-001',
    expiresAt: inDays(5),
    onHand: 10,
    unitCost: 4,
    status: 'active',
    receivedAt: new Date().toISOString(),
    productName: 'Yogur Fresa',
    ...overrides,
  };
}

describe('ExpiryRadarPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    expiringQueryInputs.length = 0;
    mockTenantSettings = {};
    mockExpiring = {
      data: { items: [], cutoff: inDays(30) },
      isLoading: false,
      error: null,
    };
    mockSuggestions = { data: { items: [] }, isLoading: false, error: null };
  });

  // the row preview follows the tenant's ladder, not a hardcode.
  it('previews the percent from the tenant tuned ladder', () => {
    mockTenantSettings = {
      discount: {
        expiryTiers: [
          { maxDays: 3, pct: 40 },
          { maxDays: 10, pct: 15 },
        ],
      },
    };
    mockExpiring.data = {
      items: [makeLot({ id: 'lot-t', expiresAt: inDays(5) })],
      cutoff: inDays(30),
    };
    render(<ExpiryRadarPanel />);

    // 5 days out: default ladder would say -30%, the tuned one says -15%.
    expect(screen.getByTestId('expiry-suggest-lot-t')).toHaveTextContent('Suggest -15%');
  });

  it('offers no CTA for a lot outside the tuned ladder window', () => {
    mockTenantSettings = { discount: { expiryTiers: [{ maxDays: 3, pct: 40 }] } };
    mockExpiring.data = {
      items: [makeLot({ id: 'lot-far', expiresAt: inDays(20) })],
      cutoff: inDays(30),
    };
    render(<ExpiryRadarPanel />);

    expect(screen.queryByTestId('expiry-suggest-lot-far')).not.toBeInTheDocument();
  });

  it('prices the risk per row and in the summary, with the urgency chip', () => {
    mockExpiring.data = {
      items: [
        makeLot({ id: 'lot-1', productName: 'Yogur Fresa', onHand: 10, unitCost: 4 }),
        makeLot({
          id: 'lot-2',
          productId: 'p-2',
          productName: 'Queso Campesino',
          lotNumber: 'L-002',
          expiresAt: inDays(20),
          onHand: 5,
          unitCost: 10,
        }),
      ],
      cutoff: inDays(30),
    };
    render(<ExpiryRadarPanel />);

    // Row risk: 10×4 and 5×10.
    expect(screen.getByTestId('expiry-risk-lot-1')).toHaveTextContent('$40.00');
    expect(screen.getByTestId('expiry-risk-lot-2')).toHaveTextContent('$50.00');
    // Summary total 90 (the KpiTile renders the formatted figure).
    expect(screen.getByText('$90.00')).toBeInTheDocument();
    // Urgency chips: 5 days → danger tier text, 20 days → in 20 days.
    expect(screen.getByTestId('expiry-days-lot-1')).toHaveTextContent('in 5 days');
    expect(screen.getByTestId('expiry-days-lot-2')).toHaveTextContent('in 20 days');
  });

  it('fires the suggest mutation with the lot id from the CTA', async () => {
    const user = userEvent.setup();
    mockExpiring.data = {
      items: [makeLot({ id: 'lot-9', expiresAt: inDays(3) })],
      cutoff: inDays(30),
    };
    render(<ExpiryRadarPanel />);

    const cta = screen.getByTestId('expiry-suggest-lot-9');
    // 3 days out → tier 1 preview (-30%).
    expect(cta).toHaveTextContent('Suggest -30%');
    await user.click(cta);
    expect(suggestMutate).toHaveBeenCalledWith({ lotId: 'lot-9' });
  });

  it('shows the active badge and dismisses through it', async () => {
    const user = userEvent.setup();
    const lot = makeLot({ id: 'lot-5' });
    mockExpiring.data = { items: [lot], cutoff: inDays(30) };
    mockSuggestions.data = {
      items: [
        {
          id: 's-5',
          productId: lot.productId,
          lotId: 'lot-5',
          lotNumber: lot.lotNumber,
          discountPct: 30,
          lotExpiresAt: lot.expiresAt,
          productName: lot.productName,
        },
      ],
    };
    render(<ExpiryRadarPanel />);

    expect(screen.getByTestId('expiry-active-lot-5')).toHaveTextContent('Active -30%');
    expect(screen.queryByTestId('expiry-suggest-lot-5')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissMutate).toHaveBeenCalledWith({ suggestionId: 's-5' });
  });

  it('renders the empty state when nothing expires in the window', () => {
    render(<ExpiryRadarPanel />);
    expect(screen.getByText('Nothing expiring soon')).toBeInTheDocument();
    expect(
      screen.getByText('No lots with stock expire within the next 30 days.')
    ).toBeInTheDocument();
  });

  // the window selector drives the query input and the copy.
  it('defaults to the 30-day sweep and re-queries on a window change', async () => {
    const user = userEvent.setup();
    render(<ExpiryRadarPanel />);

    expect(screen.getByTestId('expiry-window-30')).toHaveAttribute('aria-pressed', 'true');
    expect(expiringQueryInputs.at(-1)).toEqual({ withinDays: 30 });

    await user.click(screen.getByTestId('expiry-window-7'));
    expect(screen.getByTestId('expiry-window-7')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('expiry-window-30')).toHaveAttribute('aria-pressed', 'false');
    // The query re-runs with the picked window (the key carries it).
    expect(expiringQueryInputs.at(-1)).toEqual({ withinDays: 7 });
    // And the empty-state copy follows the selection.
    expect(
      screen.getByText('No lots with stock expire within the next 7 days.')
    ).toBeInTheDocument();
  });
});
