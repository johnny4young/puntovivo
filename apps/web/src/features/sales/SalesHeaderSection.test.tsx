import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { SalesHeaderSection } from '@/features/sales/SalesHeaderSection';

vi.mock('@/features/sales/SalesQuickSearchBar', () => ({
  SalesQuickSearchBar: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="sales-quick-search" data-disabled={String(disabled ?? false)} />
  ),
}));

vi.mock('@/features/sales/PaceToggleButton', () => ({
  PaceToggleButton: () => null,
}));

vi.mock('@/features/sales/SoundToggleButton', () => ({
  SoundToggleButton: () => null,
}));

function renderHeader(suspendedDraftsCount: number) {
  return render(
    <SalesHeaderSection
      productSearchQuery=""
      onQueryChange={vi.fn()}
      onSubmitSearch={vi.fn()}
      productInputRef={createRef<HTMLInputElement>()}
      onOpenHistory={vi.fn()}
      onOpenSuspended={vi.fn()}
      suspendedDraftsCount={suspendedDraftsCount}
      isResumedCart={false}
      itemsLocked={false}
      activeWorkspace={null}
    />
  );
}

describe('SalesHeaderSection', () => {
  it('advertises the suspended-sales shortcut only when a draft can be opened', () => {
    const empty = renderHeader(0);
    expect(screen.getByTestId('sales-open-suspended')).not.toHaveAttribute('aria-keyshortcuts');
    empty.unmount();

    renderHeader(2);
    expect(screen.getByTestId('sales-open-suspended')).toHaveAttribute('aria-keyshortcuts');
  });

  it('shows the accepted-quotation lock and disables product search', () => {
    render(
      <SalesHeaderSection
        productSearchQuery=""
        onQueryChange={vi.fn()}
        onSubmitSearch={vi.fn()}
        productInputRef={createRef<HTMLInputElement>()}
        onOpenHistory={vi.fn()}
        onOpenSuspended={vi.fn()}
        suspendedDraftsCount={0}
        isResumedCart={false}
        itemsLocked
        activeWorkspace={{ sourceQuotationNumber: 'COT-000042' } as never}
      />
    );

    expect(screen.getByTestId('quotation-cart-banner')).toHaveTextContent('COT-000042');
    expect(screen.getByTestId('sales-quick-search')).toHaveAttribute('data-disabled', 'true');
  });
});
