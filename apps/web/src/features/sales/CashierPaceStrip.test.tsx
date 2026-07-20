/**
 * pace HUD contract: the strip renders ONLY when the user opted
 * in AND a session is active AND the payload arrived; the toggle button and
 * the strip stay in lockstep through the shared preference store; the
 * trophy tile lights up on a personal best.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { CashierPaceStrip } from './CashierPaceStrip';
import { PaceToggleButton } from './PaceToggleButton';
import { setPaceHudEnabled } from './paceHudPreference';

interface MockPace {
  sessionId: string;
  sessionMinutes: number;
  salesCount: number;
  itemsQty: number;
  itemsPerMinute: number;
  avgSecondsBetweenSales: number | null;
  personalBestItemsPerMinute: number | null;
  isPersonalBest: boolean;
}

let mockPaceData: MockPace | null;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    cashSessions: {
      pace: {
        useQuery: () => ({ data: mockPaceData, isLoading: false, error: null }),
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'cashier', tenantId: 'tenant-1' } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-1' } }),
}));

const OWNER_KEY = 'tenant-1:user-1';

function makePace(overrides: Partial<MockPace> = {}): MockPace {
  return {
    sessionId: 'cs-1',
    sessionMinutes: 30,
    salesCount: 8,
    itemsQty: 46,
    itemsPerMinute: 1.5,
    avgSecondsBetweenSales: 210,
    personalBestItemsPerMinute: 2.4,
    isPersonalBest: false,
    ...overrides,
  };
}

describe('CashierPaceStrip + PaceToggleButton', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.localStorage.clear();
    setPaceHudEnabled(OWNER_KEY, false);
    mockPaceData = makePace();
  });

  it('renders nothing while the user has not opted in', () => {
    render(<CashierPaceStrip hasActiveCashSession />);
    expect(screen.queryByTestId('cashier-pace-strip')).not.toBeInTheDocument();
  });

  it('renders the three metrics once opted in with an active session', () => {
    setPaceHudEnabled(OWNER_KEY, true);
    render(<CashierPaceStrip hasActiveCashSession />);

    const strip = screen.getByTestId('cashier-pace-strip');
    expect(strip).toHaveTextContent('Items/min');
    expect(strip).toHaveTextContent('1.5');
    expect(strip).toHaveTextContent('210s');
    expect(strip).toHaveTextContent('2.4');
    expect(strip).not.toHaveTextContent('🏆');
  });

  it('lights the trophy on a personal best', () => {
    setPaceHudEnabled(OWNER_KEY, true);
    mockPaceData = makePace({ itemsPerMinute: 2.6, isPersonalBest: true });
    render(<CashierPaceStrip hasActiveCashSession />);

    expect(screen.getByTestId('cashier-pace-best')).toHaveTextContent('🏆');
  });

  it('renders nothing without an active session even when opted in', () => {
    setPaceHudEnabled(OWNER_KEY, true);
    render(<CashierPaceStrip hasActiveCashSession={false} />);
    expect(screen.queryByTestId('cashier-pace-strip')).not.toBeInTheDocument();
  });

  it('keeps the toggle and the strip in lockstep through the shared store', async () => {
    const user = userEvent.setup();
    render(
      <>
        <PaceToggleButton />
        <CashierPaceStrip hasActiveCashSession />
      </>
    );

    const toggle = screen.getByTestId('sales-pace-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('cashier-pace-strip')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cashier-pace-strip')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByTestId('cashier-pace-strip')).not.toBeInTheDocument();
  });
});
