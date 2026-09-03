import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import { InventoryHeader } from './InventoryHeader';

function renderHeader(showPharmacy: boolean) {
  render(
    <InventoryHeader
      activeView="movements"
      canManage
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
    expect(screen.getByRole('button', { name: 'Pharmacy safety' })).toBeVisible();
  });

  it('hides pharmacy operations when the tenant has neither the preset nor durable records', () => {
    renderHeader(false);
    expect(screen.queryByRole('button', { name: 'Pharmacy safety' })).not.toBeInTheDocument();
  });
});
