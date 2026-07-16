/**
 * ENG-074 — SalesCheckoutPanel hub-reachability gate tests.
 *
 * The panel disables the primary action whenever the parent passes
 * `hubReachable === false`. `undefined` (the device_local default
 * path where the parent never wires the prop) and `true` keep the
 * historical button behavior. The hint copy renders only in the
 * gated state.
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { SalesCheckoutPanel } from './SalesCheckoutPanel';

// ENG-204 — the panel mounts the pace strip (trpc + shared preference
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
    userRole?: UserRole;
  } = {}
) {
  return render(
    <SalesCheckoutPanel
      currentSite={SITE}
      cashSession={CASH_SESSION}
      registerAssignments={[REGISTER_ASSIGNMENT]}
      selectedRegisterAssignment={REGISTER_ASSIGNMENT}
      isCashSessionLoading={false}
      draftSummary={DRAFT_SUMMARY}
      canCharge={true}
      canOpenCashSession={true}
      canCloseCashSession={true}
      userRole={overrides.userRole}
      onOpenSearch={vi.fn()}
      onCharge={vi.fn()}
      onOpenCashSession={vi.fn()}
      onCloseCashSession={vi.fn()}
      onOpenMovement={vi.fn()}
      onRegisterAssignmentChange={vi.fn()}
      canSuspend={overrides.canSuspend}
      onSuspend={overrides.onSuspend}
      hubReachable={overrides.hubReachable}
      preflightItems={overrides.preflightItems}
    />
  );
}

describe('SalesCheckoutPanel hub gate (ENG-074)', () => {
  it('ENG-194 — keeps cashier guidance blind and labels privileged closes as supervised', () => {
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
    expect(screen.getByText('F1')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-primary-action')).toHaveAttribute(
      'aria-keyshortcuts',
      'F1'
    );
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

  it('ENG-105b — renders the preflight panel only when items are provided', () => {
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

  it('ENG-105b — disables the Cobrar button and links aria-describedby to the primary blocker', () => {
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

  it('ENG-105b — leaves Cobrar enabled when the only preflight item is a warning', () => {
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
});
