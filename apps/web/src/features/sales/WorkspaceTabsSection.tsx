import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { getCartSummary } from '@/features/sales/saleCartTotals';
import { type CartWorkspace } from '@/features/sales/useCartWorkspaceStore';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';
import { formatCurrency } from '@/lib/utils';

/** The open tickets of this cashier, one tab each, plus the new-ticket key. */
interface WorkspaceTabsSectionProps {
  ownedWorkspaces: CartWorkspace[];
  activeWorkspaceId: string | undefined;
  onSelectWorkspace: (workspaceId: string) => void;
  onNewSale?: (() => void) | undefined;
}

// The strip scrolls sideways, so the current ticket must not stay off to the side.
function scrollIntoRow(node: HTMLButtonElement | null) {
  node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

export function WorkspaceTabsSection({
  ownedWorkspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onNewSale,
}: WorkspaceTabsSectionProps) {
  const priceIncludesTax = usePriceIncludesTax();
  const { t } = useTranslation('sales');

  return (
    <section
      className="flex min-w-0 items-center gap-2"
      aria-label={t('park.localWorkspacesTitle')}
      data-testid="cart-workspace-switcher"
    >
      <div className="flex min-w-0 gap-2 overflow-x-auto">
        {ownedWorkspaces.map((workspace, index) => {
          const fallbackLabel = t('park.localWorkspaceFallback', {
            index: ownedWorkspaces.length - index,
          });
          const label =
            workspace.label ??
            (workspace.sourceReturnId
              ? t('exchangeCart.workspaceLabel', {
                  saleNumber: workspace.sourceReturnSaleNumber,
                })
              : workspace.sourceQuotationNumber
                ? t('quotationCart.workspaceLabel', {
                    quotationNumber: workspace.sourceQuotationNumber,
                  })
                : workspace.serverSaleNumber
                  ? t('park.localWorkspaceServerDraft', {
                      saleNumber: workspace.serverSaleNumber,
                    })
                  : fallbackLabel);
          const isActive = workspace.id === activeWorkspaceId;

          return (
            <button
              key={workspace.id}
              type="button"
              className="sales-ticket-tab"
              onClick={() => onSelectWorkspace(workspace.id)}
              aria-pressed={isActive}
              ref={isActive ? scrollIntoRow : undefined}
              aria-label={t('park.localWorkspaceSelect', { label })}
              data-testid="cart-workspace-switcher-item"
            >
              <span>{label}</span>
              <span className="font-numeric text-[15px] font-bold">
                {formatCurrency(getCartSummary(workspace.items, priceIncludesTax).total)}
              </span>
            </button>
          );
        })}
      </div>
      {onNewSale && (
        <button
          type="button"
          className="sales-ticket-tab shrink-0 px-3"
          onClick={onNewSale}
          aria-label={t('park.newSale')}
          title={t('park.newSale')}
          aria-keyshortcuts={ariaKeyshortcutsFor('sales.newSale')}
          data-testid="checkout-new-sale"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
