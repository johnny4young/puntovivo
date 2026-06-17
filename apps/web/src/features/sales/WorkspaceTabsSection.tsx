import { useTranslation } from 'react-i18next';
import { getCartSummary } from '@/features/sales/saleCart';
import { type CartWorkspace } from '@/features/sales/useCartWorkspaceStore';
import { formatCurrency } from '@/lib/utils';

/**
 * Props for {@link WorkspaceTabsSection}.
 *
 * The ENG-018b multi-cart switcher. Renders nothing unless the cashier
 * owns more than one local workspace. Purely presentational — the
 * workspace list + active id + select handler are owned by SalesPage.
 */
interface WorkspaceTabsSectionProps {
  ownedWorkspaces: CartWorkspace[];
  activeWorkspaceId: string | undefined;
  onSelectWorkspace: (workspaceId: string) => void;
}

export function WorkspaceTabsSection({
  ownedWorkspaces,
  activeWorkspaceId,
  onSelectWorkspace,
}: WorkspaceTabsSectionProps) {
  const { t } = useTranslation('sales');

  if (ownedWorkspaces.length <= 1) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-line/80 bg-surface px-4 py-3 shadow-sm xl:shrink-0"
      aria-label={t('park.localWorkspacesTitle')}
      data-testid="cart-workspace-switcher"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-secondary-950">
            {t('park.localWorkspacesTitle')}
          </p>
          <p className="text-xs text-secondary-500">
            {t('park.localWorkspacesDescription')}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {ownedWorkspaces.map((workspace, index) => {
          const workspaceSummary = getCartSummary(workspace.items);
          const fallbackLabel = t('park.localWorkspaceFallback', {
            index: ownedWorkspaces.length - index,
          });
          const label =
            workspace.label ??
            (workspace.serverSaleNumber
              ? t('park.localWorkspaceServerDraft', {
                  saleNumber: workspace.serverSaleNumber,
                })
              : fallbackLabel);
          const isActive = workspace.id === activeWorkspaceId;

          return (
            <button
              key={workspace.id}
              type="button"
              className={
                isActive
                  ? 'rounded-2xl border border-primary-300 bg-primary-50 px-3 py-2 text-left text-sm text-primary-900'
                  : 'rounded-2xl border border-line bg-white px-3 py-2 text-left text-sm text-secondary-700 hover:border-primary-200 hover:bg-primary-50/60'
              }
              onClick={() => onSelectWorkspace(workspace.id)}
              aria-pressed={isActive}
              aria-label={t('park.localWorkspaceSelect', { label })}
              data-testid="cart-workspace-switcher-item"
            >
              <span className="block whitespace-nowrap font-semibold">
                {label}
              </span>
              <span className="mt-1 block whitespace-nowrap text-xs opacity-75">
                {t('park.items', { count: workspaceSummary.itemCount })} ·{' '}
                {formatCurrency(workspaceSummary.total)}
              </span>
              {isActive && (
                <span className="mt-1 inline-flex rounded-full bg-primary-100 px-2 py-0.5 text-[0.65rem] font-semibold text-primary-700">
                  {t('park.localWorkspaceActive')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
