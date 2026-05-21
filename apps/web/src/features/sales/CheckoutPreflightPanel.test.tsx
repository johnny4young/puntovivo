/**
 * ENG-105b — Coverage for `<CheckoutPreflightPanel />`.
 *
 * Pins the rendering contract (hidden when empty, blockers vs
 * warnings styling, recovery CTA wiring, axe-AA pass under the
 * shared a11y helper).
 *
 * @module features/sales/CheckoutPreflightPanel.test
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { assertNoA11yViolations } from '@/test/a11y';
import {
  CheckoutPreflightPanel,
  PREFLIGHT_PRIMARY_ELEMENT_ID,
} from './CheckoutPreflightPanel';
import type { PreflightItem } from './useCheckoutPreflight';

function blocker(overrides?: Partial<PreflightItem>): PreflightItem {
  return {
    id: 'cash_session_required',
    severity: 'blocker',
    messageKey: 'preflight.items.cash_session_required.message',
    ...overrides,
  } as PreflightItem;
}

function warning(overrides?: Partial<PreflightItem>): PreflightItem {
  return {
    id: 'insufficient_stock',
    severity: 'warning',
    messageKey: 'preflight.items.insufficient_stock.message',
    messageValues: { product: 'Aceite 1L', count: 1 },
    ...overrides,
  } as PreflightItem;
}

describe('<CheckoutPreflightPanel />', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<CheckoutPreflightPanel items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a single blocker with the danger styling and the title', () => {
    render(<CheckoutPreflightPanel items={[blocker()]} />);
    expect(screen.getByTestId('checkout-preflight-panel')).toBeInTheDocument();
    expect(screen.getByTestId('checkout-preflight-blocker-cash_session_required')).toBeInTheDocument();
  });

  it('anchors only the FIRST blocker with the primary element id (for aria-describedby)', () => {
    render(
      <CheckoutPreflightPanel
        items={[
          blocker({ id: 'cash_session_required' }),
          blocker({
            id: 'credit_sale_customer_required',
            messageKey: 'preflight.items.credit_sale_customer_required.message',
          }),
        ]}
      />
    );
    const primary = document.getElementById(PREFLIGHT_PRIMARY_ELEMENT_ID);
    expect(primary).not.toBeNull();
    expect(primary?.dataset.testid).toBe(
      'checkout-preflight-blocker-cash_session_required'
    );
  });

  it('renders a warning with the warning styling', () => {
    render(<CheckoutPreflightPanel items={[warning()]} />);
    expect(
      screen.getByTestId('checkout-preflight-warning-insufficient_stock')
    ).toBeInTheDocument();
    // Warnings should NOT receive the primary id (only blockers do).
    expect(document.getElementById(PREFLIGHT_PRIMARY_ELEMENT_ID)).toBeNull();
  });

  it('renders a recovery CTA when the item has one and dispatches the callback on click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <CheckoutPreflightPanel
        items={[
          blocker({
            recoveryAction: {
              labelKey: 'preflight.items.cash_session_required.recovery',
              onClick,
            },
          }),
        ]}
      />
    );
    const cta = screen.getByTestId('checkout-preflight-recovery-cash_session_required');
    await user.click(cta);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders blockers first then warnings (caller-provided order is preserved)', () => {
    render(
      <CheckoutPreflightPanel
        items={[blocker(), warning()]}
      />
    );
    const list = screen.getByTestId('checkout-preflight-panel').querySelector('ul');
    expect(list).not.toBeNull();
    const liDataAttrs = Array.from(list!.querySelectorAll('li')).map(
      li => (li as HTMLLIElement).dataset.testid
    );
    expect(liDataAttrs).toEqual([
      'checkout-preflight-blocker-cash_session_required',
      'checkout-preflight-warning-insufficient_stock',
    ]);
  });

  it('passes axe-AA when rendering a typical multi-item set', async () => {
    const { container } = render(
      <CheckoutPreflightPanel
        items={[
          blocker({
            recoveryAction: {
              labelKey: 'preflight.items.cash_session_required.recovery',
              onClick: vi.fn(),
            },
          }),
          warning({
            recoveryAction: {
              labelKey: 'preflight.items.insufficient_stock.recovery',
              onClick: vi.fn(),
            },
          }),
        ]}
      />
    );
    await assertNoA11yViolations(container);
  });

  it('reads in Spanish when the locale flips', async () => {
    await i18n.changeLanguage('es');
    render(<CheckoutPreflightPanel items={[blocker()]} />);
    // The panel title key is `sales:preflight.title` — verify it renders
    // a non-empty Spanish string (we do not pin the exact wording to
    // avoid coupling the test to copy iterations).
    const title = screen
      .getByTestId('checkout-preflight-panel')
      .querySelector('p');
    expect(title?.textContent ?? '').not.toBe('');
    expect(title?.textContent ?? '').not.toMatch(/^preflight\./);
  });
});
