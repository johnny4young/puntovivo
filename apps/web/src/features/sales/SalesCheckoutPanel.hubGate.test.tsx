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
import type { CashSession, RegisterAssignment, Site } from '@/types';

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

function renderPanel(overrides: { hubReachable?: boolean | undefined } = {}) {
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
      onOpenSearch={vi.fn()}
      onCharge={vi.fn()}
      onOpenCashSession={vi.fn()}
      onCloseCashSession={vi.fn()}
      onOpenMovement={vi.fn()}
      onRegisterAssignmentChange={vi.fn()}
      hubReachable={overrides.hubReachable}
    />
  );
}

describe('SalesCheckoutPanel hub gate (ENG-074)', () => {
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
});
