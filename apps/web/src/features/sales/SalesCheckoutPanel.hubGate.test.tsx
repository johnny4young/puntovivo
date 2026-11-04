/**
 * SalesCheckoutPanel hub-reachability gate tests.
 *
 * The panel disables the primary action whenever the parent passes
 * `hubReachable === false`. `undefined` (the device_local default
 * path where the parent never wires the prop) and `true` keep the
 * historical button behavior. The hint copy renders only in the
 * gated state.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { render } from '@/test/utils';
import { SalesCheckoutPanel } from './SalesCheckoutPanel';

// the panel mounts the pace strip (trpc + shared preference
// underneath); mock the hook so this suite stays network-free. Its own
// behavior is pinned in CashierPaceStrip.test.tsx.
vi.mock('@/features/sales/useCashierPace', () => ({
  useCashierPace: () => ({ enabled: false, toggle: vi.fn(), pace: null }),
}));
import { PREFLIGHT_PRIMARY_ELEMENT_ID } from './CheckoutPreflightPanel';
import type { PreflightItem } from './useCheckoutPreflight';
import type { CashSession, RegisterAssignment, Site, UserRole } from '@/types';

const SITE: Site = {
  id: 'site-1',
  tenantId: 'tenant-1',
  name: 'Main Store',
  isActive: true,
  createdAt: '',
  updatedAt: '',
} as unknown as Site;

const REGISTER_ASSIGNMENT: RegisterAssignment = {
  id: 'register-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  cashierId: 'cashier-1',
  registerName: 'Register A',
  active: true,
} as unknown as RegisterAssignment;

const CASH_SESSION: CashSession = {
  id: 'cash-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  cashierId: 'cashier-1',
  registerName: 'Register A',
  status: 'open',
  openingBalance: 100,
  openedAt: new Date().toISOString(),
} as unknown as CashSession;

const DRAFT_SUMMARY = {
  itemCount: 1,
  subtotal: 100,
  taxAmount: 19,
  discountAmount: 0,
  total: 119,
};

function renderPanel(
  overrides: {
    hubReachable?: boolean | undefined;
    preflightItems?: readonly PreflightItem[];
    canSuspend?: boolean;
    onSuspend?: () => void;
    suspendedDraftsCount?: number;
    onToggleSuspendedPanel?: () => void;
    userRole?: UserRole;
    cashSession?: CashSession | null;
    canOpenSearch?: boolean;
    onFastCash?: () => void;
  } = {}
) {
  return render(
    <SalesCheckoutPanel
      currentSite={SITE}
      cashSession={overrides.cashSession === undefined ? CASH_SESSION : overrides.cashSession}
      registerAssignments={[REGISTER_ASSIGNMENT]}
      selectedRegisterAssignment={REGISTER_ASSIGNMENT}
      isCashSessionLoading={false}
      draftSummary={DRAFT_SUMMARY}
      canCharge={true}
      canOpenCashSession={true}
      canCloseCashSession={true}
      userRole={overrides.userRole}
      canOpenSearch={overrides.canOpenSearch}
      onOpenSearch={vi.fn()}
      onCharge={vi.fn()}
      onOpenCashSession={vi.fn()}
      onCloseCashSession={vi.fn()}
      onOpenMovement={vi.fn()}
      onRegisterAssignmentChange={vi.fn()}
      canSuspend={overrides.canSuspend}
      onSuspend={overrides.onSuspend}
      suspendedDraftsCount={overrides.suspendedDraftsCount}
      onToggleSuspendedPanel={overrides.onToggleSuspendedPanel}
      hubReachable={overrides.hubReachable}
      preflightItems={overrides.preflightItems}
      onFastCash={overrides.onFastCash}
    />
  );
}

describe('SalesCheckoutPanel hub gate', () => {
  it(' — keeps cashier guidance blind and labels privileged closes as supervised', () => {
    const cashier = renderPanel({ userRole: 'cashier' });
    expect(screen.getByText(/blind close keeps/i)).toBeInTheDocument();
    expect(screen.queryByText(/supervised close shows/i)).not.toBeInTheDocument();
    cashier.unmount();

    renderPanel({ userRole: 'manager' });
    expect(screen.getByText(/supervised close shows/i)).toBeInTheDocument();
    expect(screen.queryByText(/blind close keeps/i)).not.toBeInTheDocument();
  });

  it('renders shortcut chips from the canonical shortcut catalogue', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux x86_64',
      configurable: true,
    });
    renderPanel();
    expect(screen.getByText('F5')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+P')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+R')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('checkout-shortcut-chips')).getByText('F1')
    ).toBeInTheDocument();
    expect(screen.getByTestId('checkout-primary-action')).toHaveAttribute(
      'aria-keyshortcuts',
      'F1'
    );
  });

  it('does not advertise product search for an immutable cart', () => {
    renderPanel({ canOpenSearch: false });

    const search = screen.getByRole('button', { name: /search products/i });
    expect(search).toBeDisabled();
    expect(search).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByText('F5')).not.toBeInTheDocument();
  });

  it('disables closing the cash session only while the hub is unreachable', () => {
    const { unmount } = renderPanel({ hubReachable: false });
    expect(screen.getByRole('button', { name: 'Close cash session' })).toBeDisabled();
    unmount();

    renderPanel({ hubReachable: undefined });
    expect(screen.getByRole('button', { name: 'Close cash session' })).toBeEnabled();
  });

  it('enables the primary action when hubReachable is undefined (device_local default)', () => {
    renderPanel({ hubReachable: undefined });
    const button = screen.getByTestId('checkout-primary-action');
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId('checkout-hub-gate-hint')).not.toBeInTheDocument();
  });

  it('enables the primary action when hubReachable is true (hub_client + reachable)', () => {
    renderPanel({ hubReachable: true });
    const button = screen.getByTestId('checkout-primary-action');
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId('checkout-hub-gate-hint')).not.toBeInTheDocument();
  });

  it('disables the primary action and renders the hint when hubReachable is false (hub_client + unreachable)', () => {
    renderPanel({ hubReachable: false });
    const button = screen.getByTestId('checkout-primary-action');
    expect(button).toBeDisabled();
    const hint = screen.getByTestId('checkout-hub-gate-hint');
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/hub/i);
  });

  it(' — renders the preflight panel only when items are provided', () => {
    const empty = renderPanel({ preflightItems: [] });
    expect(empty.queryByTestId('checkout-preflight-panel')).not.toBeInTheDocument();
    empty.unmount();

    renderPanel({
      preflightItems: [
        {
          id: 'cash_session_required',
          severity: 'blocker',
          messageKey: 'preflight.items.cash_session_required.message',
        },
      ],
    });
    expect(screen.getByTestId('checkout-preflight-panel')).toBeInTheDocument();
  });

  it(' — disables the Cobrar button and links aria-describedby to the primary blocker', () => {
    renderPanel({
      preflightItems: [
        {
          id: 'cash_session_required',
          severity: 'blocker',
          messageKey: 'preflight.items.cash_session_required.message',
        },
      ],
    });
    const button = screen.getByTestId('checkout-primary-action');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby', PREFLIGHT_PRIMARY_ELEMENT_ID);
    expect(document.getElementById(PREFLIGHT_PRIMARY_ELEMENT_ID)).not.toBeNull();
  });

  it(' — leaves Cobrar enabled when the only preflight item is a warning', () => {
    renderPanel({
      preflightItems: [
        {
          id: 'insufficient_stock',
          severity: 'warning',
          messageKey: 'preflight.items.insufficient_stock.message',
          messageValues: { product: 'Aceite 1L', count: 1 },
        },
      ],
    });
    const button = screen.getByTestId('checkout-primary-action');
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('labels the primary action with its shortcut without changing its accessible name', () => {
    renderPanel();

    const button = screen.getByRole('button', { name: 'Charge sale' });
    expect(within(button).getByText('F1')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByTestId('checkout-primary-action')).toHaveLength(1);
  });

  it('offers fast cash only while the sale can be charged', () => {
    const onFastCash = vi.fn();
    const ready = renderPanel({ onFastCash });
    fireEvent.click(screen.getByTestId('checkout-fast-cash'));
    expect(onFastCash).toHaveBeenCalledOnce();
    ready.unmount();

    const gated = renderPanel({ onFastCash, hubReachable: false });
    expect(screen.queryByTestId('checkout-fast-cash')).not.toBeInTheDocument();
    gated.unmount();

    renderPanel({
      onFastCash,
      preflightItems: [
        {
          id: 'discount_exceeds_total',
          severity: 'blocker',
          messageKey: 'preflight.items.cash_session_required.message',
        },
      ],
    });
    expect(screen.queryByTestId('checkout-fast-cash')).not.toBeInTheDocument();
  });

  it('leaves the closed register and sync backlog to their own surfaces', () => {
    renderPanel({
      cashSession: null,
      preflightItems: [
        {
          id: 'cash_session_required',
          severity: 'blocker',
          messageKey: 'preflight.items.cash_session_required.message',
        },
        {
          id: 'sync_backlog',
          severity: 'warning',
          messageKey: 'preflight.items.cash_session_required.message',
        },
      ],
    });

    expect(screen.queryByTestId('checkout-preflight-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('checkout-primary-action')).not.toHaveAttribute('aria-describedby');
  });

  it('hides Suspend when it is wired but unavailable', () => {
    renderPanel({ canSuspend: false, onSuspend: vi.fn() });

    expect(screen.queryByTestId('checkout-suspend')).not.toBeInTheDocument();
    expect(screen.queryByTestId('checkout-park-controls')).not.toBeInTheDocument();
  });

  it('renders Suspend when it is wired and available', () => {
    renderPanel({ canSuspend: true, onSuspend: vi.fn() });

    const button = screen.getByTestId('checkout-suspend');
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-keyshortcuts');
  });

  it('advertises the suspended-sales shortcut only when a draft can be opened', () => {
    const empty = renderPanel({
      suspendedDraftsCount: 0,
      onToggleSuspendedPanel: vi.fn(),
    });
    expect(screen.getByTestId('checkout-open-suspended-panel')).not.toHaveAttribute(
      'aria-keyshortcuts'
    );
    empty.unmount();

    renderPanel({
      suspendedDraftsCount: 2,
      onToggleSuspendedPanel: vi.fn(),
    });
    expect(screen.getByTestId('checkout-open-suspended-panel')).toHaveAttribute(
      'aria-keyshortcuts'
    );
  });
});
