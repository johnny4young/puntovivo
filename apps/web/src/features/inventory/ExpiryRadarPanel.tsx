import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlarmClock, BadgePercent, CalendarClock, Package } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { KpiTile } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

/** The radar's fixed look-ahead window (days). A selector is a captured
 * follow-up; 30 days covers every discount tier. */
/** ENG-212 — selectable look-ahead windows. 30 stays the default (it covers
 * every default tier); 60 lets a pharmacy-style catalog sweep wider, 7/15
 * narrow the list to what is actually urgent this week. */
const EXPIRY_WINDOW_OPTIONS = [7, 15, 30, 60] as const;
const DEFAULT_EXPIRY_WINDOW_DAYS = 30;

/** ENG-211 — the ENG-199 ladder stays the fallback for tenants that never
 * tuned it (and for a session payload that predates the setting). */
const DEFAULT_TIERS: ReadonlyArray<{ maxDays: number; pct: number }> = [
  { maxDays: 7, pct: 30 },
  { maxDays: 15, pct: 20 },
  { maxDays: 30, pct: 10 },
];

/**
 * Display mirror of the server tier rule (services/price-suggestions.ts),
 * evaluated against the TENANT's ladder (ENG-211). The server RECOMPUTES
 * the percent on accept from its own copy of the same settings, so drift
 * shows a stale preview, never a wrong stored value.
 */
function previewPctForDays(
  daysLeft: number,
  tiers: ReadonlyArray<{ maxDays: number; pct: number }>
): number | null {
  if (daysLeft < 0) return null;
  for (const tier of tiers) {
    if (daysLeft <= tier.maxDays) return tier.pct;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One radar row: an expiring lot joined with its active suggestion (if any). */
interface ExpiryRadarRow {
  lotId: string;
  productName: string;
  lotNumber: string;
  expiresAt: string | null;
  daysLeft: number;
  onHand: number;
  unitCost: number;
  valueAtRisk: number;
  previewPct: number | null;
  suggestion: { id: string; discountPct: number } | null;
}

function urgencyTone(daysLeft: number): 'danger' | 'warning' | 'neutral' {
  if (daysLeft <= 7) return 'danger';
  if (daysLeft <= 15) return 'warning';
  return 'neutral';
}

/**
 * ENG-199 (WC-C3) — the actionable expiry radar. Lists the tenant's lots
 * expiring within 30 days (FEFO order comes from the server), prices the
 * risk per row (on hand × unit cost), and lets a manager accept the
 * deterministic tier discount per lot. Active suggestions render as a badge
 * with a dismiss affordance; the same suggestions feed the POS badge via
 * `inventoryLots.activeSuggestions`. Mounted only on the `expiry` tab of
 * /inventory, which is manager/admin territory (route-level gate).
 */
export function ExpiryRadarPanel() {
  const { t } = useTranslation('inventory');
  // ENG-211 — the tenant's tuned ladder rides the auth.me session payload
  // (same channel as the ENG-194b blind-close flag); fall back to the
  // ENG-199 defaults when the tenant never tuned it.
  const { tenantSettings } = useTenant();
  const tiers = tenantSettings?.discount?.expiryTiers ?? DEFAULT_TIERS;
  const toast = useToast();
  const utils = trpc.useUtils();

  // ENG-212 — the operator picks the sweep; the query key carries it, so
  // switching windows refetches (and caches) per window.
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_EXPIRY_WINDOW_DAYS);
  const expiringQuery = trpc.inventoryLots.expiring.useQuery({ withinDays: windowDays });
  const suggestionsQuery = trpc.inventoryLots.activeSuggestions.useQuery(undefined);

  const invalidate = async () => {
    await Promise.all([
      utils.inventoryLots.activeSuggestions.invalidate(),
      utils.inventoryLots.expiring.invalidate(),
    ]);
  };

  const suggestMutation = trpc.inventoryLots.suggestDiscount.useMutation({
    onSuccess: async suggestion => {
      await invalidate();
      toast.success({
        title: t('expiry.toast.suggestedTitle'),
        description: t('expiry.toast.suggestedDescription', {
          pct: suggestion.discountPct,
          product: suggestion.productName,
        }),
      });
    },
    onError: onErrorToast(toast, t),
  });
  const dismissMutation = trpc.inventoryLots.dismissSuggestion.useMutation({
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: t('expiry.toast.dismissedTitle') });
    },
    onError: onErrorToast(toast, t),
  });

  // Frozen at mount (ENG-195 precedent): day distances are day-granular and
  // the panel remounts per tab visit, so a per-render clock read buys
  // nothing and trips react-hooks/purity.
  const [now] = useState(() => Date.now());

  const rows = useMemo<ExpiryRadarRow[]>(() => {
    const items = expiringQuery.data?.items ?? [];
    const byLot = new Map(
      (suggestionsQuery.data?.items ?? []).map(item => [
        item.lotId,
        { id: item.id, discountPct: item.discountPct },
      ])
    );
    return items.map(item => {
      const daysLeft = item.expiresAt
        ? Math.max(0, Math.ceil((Date.parse(item.expiresAt) - now) / DAY_MS))
        : 0;
      return {
        lotId: item.id,
        productName: item.productName,
        lotNumber: item.lotNumber,
        expiresAt: item.expiresAt,
        daysLeft,
        onHand: item.onHand,
        unitCost: item.unitCost,
        valueAtRisk: item.onHand * item.unitCost,
        previewPct: previewPctForDays(daysLeft, tiers),
        suggestion: byLot.get(item.id) ?? null,
      };
    });
  }, [expiringQuery.data, suggestionsQuery.data, now, tiers]);

  const totalValueAtRisk = rows.reduce((sum, row) => sum + row.valueAtRisk, 0);
  const activeCount = rows.filter(row => row.suggestion !== null).length;
  const isMutating = suggestMutation.isPending || dismissMutation.isPending;

  const columns = useMemo<ColumnDef<ExpiryRadarRow>[]>(
    () => [
      {
        accessorKey: 'productName',
        header: () => t('expiry.columns.product'),
        size: 260,
        cell: ({ row }) => (
          <div className="prod">
            <span className="pic">
              <Package className="h-4 w-4" />
            </span>
            <div>
              <p className="pname">{row.original.productName}</p>
              <p className="sku">{row.original.lotNumber}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'expiresAt',
        header: () => t('expiry.columns.expires'),
        size: 190,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{row.original.expiresAt ? formatDate(row.original.expiresAt) : '—'}</span>
            <span
              className={cn('pv-badge', urgencyTone(row.original.daysLeft))}
              data-testid={`expiry-days-${row.original.lotId}`}
            >
              {row.original.daysLeft === 0
                ? t('expiry.today')
                : t('expiry.daysLeft', { count: row.original.daysLeft })}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'onHand',
        header: () => t('expiry.columns.onHand'),
        size: 110,
        meta: { cellClassName: 'num', headerClassName: 'num' },
        cell: ({ row }) => row.original.onHand.toLocaleString(),
      },
      {
        accessorKey: 'unitCost',
        header: () => t('expiry.columns.unitCost'),
        size: 130,
        meta: { cellClassName: 'num', headerClassName: 'num' },
        cell: ({ row }) => formatCurrency(row.original.unitCost),
      },
      {
        accessorKey: 'valueAtRisk',
        header: () => t('expiry.columns.valueAtRisk'),
        size: 150,
        meta: { cellClassName: 'num', headerClassName: 'num' },
        cell: ({ row }) => (
          <span className="font-semibold" data-testid={`expiry-risk-${row.original.lotId}`}>
            {formatCurrency(row.original.valueAtRisk)}
          </span>
        ),
      },
      {
        id: 'action',
        header: () => t('expiry.columns.action'),
        size: 230,
        cell: ({ row }) =>
          row.original.suggestion ? (
            <div className="flex items-center gap-2">
              <span
                className="pv-badge success"
                data-testid={`expiry-active-${row.original.lotId}`}
              >
                {t('expiry.activeBadge', { pct: row.original.suggestion.discountPct })}
              </span>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={isMutating}
                onClick={() =>
                  dismissMutation.mutate({ suggestionId: row.original.suggestion!.id })
                }
              >
                {t('expiry.dismiss')}
              </button>
            </div>
          ) : row.original.previewPct !== null ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={isMutating}
              data-testid={`expiry-suggest-${row.original.lotId}`}
              onClick={() => suggestMutation.mutate({ lotId: row.original.lotId })}
            >
              {t('expiry.suggest', { pct: row.original.previewPct })}
            </button>
          ) : (
            <span className="text-secondary-400">—</span>
          ),
      },
    ],
    [t, isMutating, dismissMutation, suggestMutation]
  );

  return (
    <div className="space-y-4" data-testid="expiry-radar-panel">
      {/* ENG-212 — window sweep selector. A segmented control (not a select)
       * so the four options are one tap away on the tablet the manager
       * actually walks the aisles with. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-secondary-500">
          {t('expiry.windowLabel')}
        </span>
        <div className="segmented-control" role="group" aria-label={t('expiry.windowLabel')}>
          {EXPIRY_WINDOW_OPTIONS.map(option => (
            <button
              key={option}
              type="button"
              className={cn('segmented-tab', windowDays === option && 'segmented-tab-active')}
              aria-pressed={windowDays === option}
              data-testid={`expiry-window-${option}`}
              onClick={() => setWindowDays(option)}
            >
              {t('expiry.windowOption', { days: option })}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile
          icon={CalendarClock}
          tone={rows.length > 0 ? 'warning' : 'ink'}
          label={t('expiry.summary.lots')}
          value={rows.length.toLocaleString()}
          context={t('expiry.summary.window', { days: windowDays })}
        />
        <KpiTile
          icon={AlarmClock}
          tone={totalValueAtRisk > 0 ? 'danger' : 'ink'}
          mono
          label={t('expiry.summary.valueAtRisk')}
          value={formatCurrency(totalValueAtRisk)}
        />
        <KpiTile
          icon={BadgePercent}
          tone={activeCount > 0 ? 'success' : 'ink'}
          label={t('expiry.summary.activeSuggestions')}
          value={activeCount.toLocaleString()}
        />
      </div>

      <div className="card overflow-hidden">
        {expiringQuery.isLoading || suggestionsQuery.isLoading ? (
          <TableLoadingState message={t('expiry.loading')} rowCount={6} />
        ) : expiringQuery.error ? (
          <TableErrorState
            title={t('expiry.toast.errorTitle')}
            message={translateServerError(expiringQuery.error, t, expiringQuery.error.message)}
            onRetry={() => {
              void expiringQuery.refetch();
            }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t('expiry.emptyTitle')}
            description={t('expiry.emptyDescription', { days: windowDays })}
          />
        ) : (
          <DataTable
            variant="dense"
            columns={columns}
            data={rows}
            searchKey="productName"
            searchPlaceholder={t('expiry.search')}
            pageSize={10}
          />
        )}
      </div>
    </div>
  );
}
