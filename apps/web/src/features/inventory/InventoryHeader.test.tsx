import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import { InventoryHeader } from './InventoryHeader';

function renderHeader(showPharmacy: boolean, canManage = true) {
  render(
    <InventoryHeader
      activeView="movements"
      canManage={canManage}
      showPharmacy={showPharmacy}
      onViewChange={vi.fn()}
      onNewEntry={vi.fn()}
      onNewAdjustment={vi.fn()}
    />
  );
}

describe('InventoryHeader vertical tabs', () => {
  it('shows pharmacy safety whenever the parent marks pharmacy operations relevant', () => {
    renderHeader(true);
    expect(screen.getByRole('tab', { name: 'Pharmacy safety' })).toBeVisible();
  });

  it('hides pharmacy operations when the tenant has neither the preset nor durable records', () => {
    renderHeader(false);
    expect(screen.queryByRole('tab', { name: 'Pharmacy safety' })).not.toBeInTheDocument();
  });

  it('names a group left with one view after that view and wires every tab to the panel', () => {
    renderHeader(false, false);
    expect(screen.queryByRole('tab', { name: 'Counts & expiry' })).not.toBeInTheDocument();
    const expiry = screen.getByTestId('inventory-tab-expiry');
    expect(expiry).toHaveAccessibleName('Expiry');
    expect(expiry).toHaveAttribute('id', 'inventory-view-tab-expiry');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'inventory-tabpanel');
    }
  });
});
