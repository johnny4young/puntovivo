import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import type { CartWorkspace } from './useCartWorkspaceStore';
import { WorkspaceTabsSection } from './WorkspaceTabsSection';

vi.mock('@/features/pricing/PricingContext', () => ({
  usePriceIncludesTax: () => true,
}));

function workspace(id: string, overrides?: Partial<CartWorkspace>): CartWorkspace {
  return { id, items: [], label: null, ...overrides } as CartWorkspace;
}

describe('WorkspaceTabsSection', () => {
  it('shows the only open ticket with its total', () => {
    render(
      <WorkspaceTabsSection
        ownedWorkspaces={[workspace('w1')]}
        activeWorkspaceId="w1"
        onSelectWorkspace={vi.fn()}
      />
    );

    const tab = screen.getByTestId('cart-workspace-switcher-item');
    expect(tab).toHaveAttribute('aria-pressed', 'true');
    expect(tab).toHaveTextContent('Cart 1');
    expect(tab).toHaveTextContent(formatCurrency(0));
  });

  it('switches tickets and names each one', () => {
    const onSelectWorkspace = vi.fn();
    render(
      <WorkspaceTabsSection
        ownedWorkspaces={[workspace('w2', { label: 'Table 5' }), workspace('w1')]}
        activeWorkspaceId="w1"
        onSelectWorkspace={onSelectWorkspace}
      />
    );

    const parked = screen.getByRole('button', { name: 'Switch to Table 5' });
    expect(parked).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(parked);
    expect(onSelectWorkspace).toHaveBeenCalledWith('w2');
  });

  it('opens a new ticket from the strip', () => {
    const onNewSale = vi.fn();
    render(
      <WorkspaceTabsSection
        ownedWorkspaces={[workspace('w1')]}
        activeWorkspaceId="w1"
        onSelectWorkspace={vi.fn()}
        onNewSale={onNewSale}
      />
    );

    const add = screen.getByTestId('checkout-new-sale');
    expect(add).toHaveAccessibleName('New sale');
    expect(add).toHaveAttribute('aria-keyshortcuts');
    fireEvent.click(add);
    expect(onNewSale).toHaveBeenCalledOnce();
  });
});
