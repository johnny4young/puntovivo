import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData } from '@tanstack/react-query';
import { useReceiptAutoPrint } from '@/features/sales/useReceiptAutoPrint';
import { type PreflightBlockerId, type PreflightItem } from '@/features/sales/useCheckoutPreflight';
import { DEFAULT_WEDGE_CONFIG, type WedgeConfig } from '@/features/sales/useBarcodeWedgeListener';
import { trpc } from '@/lib/trpc';
import type {
  CashSession,
  Category,
  Customer,
  Provider,
  RegisterAssignment,
  Sale,
  Site,
  Tenant,
  User,
} from '@/types';

/**
 * Params for {@link useSalesPageData}.
 *
 * slice 16b-2 — the SalesPage data layer (the nine tRPC queries +
 * their derived/normalized values + the checkout-readiness memo + the shared
 * peripherals derivations) was extracted verbatim from SalesPage. The hook
 * reads the tenant/site/user context + the selected-register id from the
 * shell; everything it returns flows back out so the shell keeps wiring the
 * presentational tree and the controller hooks unchanged.
 */
export interface UseSalesPageDataParams {
  currentSite: Site | null;
  currentTenant: Tenant | null;
  user: User | null;
  /** The operator-picked register, or null to fall back to the first free one. */
  selectedRegisterAssignmentId: string | null;
}

/**
 * Owns the SalesPage read side: the high-traffic entry queries (sales,
 * customers, categories, providers, active cash session, register
 * assignments, suspended drafts, the SHARED peripherals subscription, and
 * checkout readiness), the `maybeAutoPrint` dispatcher, the
 * `checkoutReadinessItems` preflight memo, and the normalized arrays + derived
 * flags the shell threads into the checkout panel, the modal clusters, and the
 * scanner/drawer hooks. The single `peripherals.activeForSite` subscription
 * () lives here and is exposed only as derived values
 * (`autoPrintEnabled`/`scannerConfig`/`hasRegisteredDrawer`), never re-queried.
 */
export function useSalesPageData({
  currentSite,
  currentTenant,
  user,
  selectedRegisterAssignmentId,
}: UseSalesPageDataParams) {
  // `placeholderData: keepPreviousData` on the high-traffic
  // entry queries so navigating into /sales (or re-fetching on a key
  // change such as a site switch) keeps the last data on screen instead
  // of blanking the shell while the new request is in flight. Paired with
  // the hover-prefetch on the sidebar /sales entry (usePrefetchSales).
  const salesQuery = trpc.sales.list.useQuery(
    { page: 1, perPage: 50 },
    { placeholderData: keepPreviousData }
  );
  const customersQuery = trpc.customers.list.useQuery(
    { page: 1, perPage: 100, isActive: true },
    { placeholderData: keepPreviousData }
  );
  const categoriesQuery = trpc.categories.tree.useQuery();
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });
  const activeCashSessionQuery = trpc.cashSessions.getActive.useQuery(
    { siteId: currentSite?.id },
    {
      enabled: !!currentSite,
      placeholderData: keepPreviousData,
    }
  );
  const activeCashSession = (activeCashSessionQuery.data as CashSession | null | undefined) ?? null;
  const registerAssignmentsQuery = trpc.cashSessions.registerAssignments.useQuery(undefined, {
    enabled: !!currentSite,
  });
  // pre-fetch suspended-drafts count for the close-session
  // modal warning. Query stays enabled so the panel toggle + the
  // modal warning always see a fresh count; the payload is tiny
  // (paginated, 50 rows max).
  const draftsQuery = trpc.sales.listDrafts.useQuery(
    { page: 1, perPage: 50 },
    { enabled: !!currentTenant }
  );
  const suspendedDraftsCount = draftsQuery.data?.totalItems ?? 0;

  // auto-print on sale completion.
  //
  // The active site's active printer config is read via the SAME
  // `peripherals.activeForSite` query that  already mounts for
  // the barcode scanner + cash-drawer detection. This hook owns that
  // single subscription so both  and the  consumers
  // (scanner, cash drawer) share it — two separate `useQuery` calls
  // would resolve to the same cache key but generate duplicate
  // background refetches with mismatched `staleTime`. When the active
  // printer ships with `config.autoPrintOnComplete: true`, every
  // successful sale (fresh create OR completeDraft) fires
  // `peripherals.printReceipt` through the same dispatcher the
  // SaleDetailsModal reprint path uses, so the dispatch decision
  // (device_local / site_hub server-side vs. hub_client bridge) stays
  // in one place. Defaults to `false` so existing tenants do not get
  // surprise prints — opt-in is explicit per site at the peripheral
  // config level.
  //
  // Failures fall through the existing fallback chain (system print
  // → browser print window) inside `printSaleReceipt`. We surface a
  // warning toast when the ESC/POS path fails so the cashier knows
  // the receipt landed on a different surface; the operator can
  // diagnose via the hardware_outbox surface in Operations.
  const peripheralsForSiteQuery = trpc.peripherals.activeForSite.useQuery(
    { siteId: currentSite?.id ?? '' },
    { enabled: !!currentSite, staleTime: 5 * 60 * 1000 }
  );
  const autoPrintEnabled = (() => {
    const rows = peripheralsForSiteQuery.data;
    if (!rows) return false;
    const printer = rows.find(row => row.kind === 'printer');
    if (!printer) return false;
    const config = printer.config as Record<string, unknown> | null;
    return config?.autoPrintOnComplete === true;
  })();
  // auto-print on sale completion. `autoPrintEnabled` is derived
  // from the SHARED `peripherals.activeForSite` query (single subscription
  // for scanner + drawer + auto-print); `maybeAutoPrint` fires from the
  // mutation success paths after the completion toast.
  const maybeAutoPrint = useReceiptAutoPrint({ autoPrintEnabled });

  // Checkout preflight. Surfaces actionable blockers above
  // the Cobrar button so the cashier resolves them BEFORE pressing F1
  // instead of bouncing off a server toast mid-checkout. Pre-modal
  // primitives (paymentMethod, selectedCustomer, pendingDiscountAmount)
  // are not yet wired from SalesPage — the hook silently skips those
  // blocker families, leaving the current modal-level fallback toasts
  // in place. Future slices will plumb pre-attach customer / cart-level
  // discount through here.
  // checkout readiness reminders from the server (fiscal not
  // active, no printer, no payment rail, sync backlog). Loading / errored
  // → no items, so a slow or offline server NEVER blocks the sale
  // (local-first). All warnings; cashiers see the message, only
  // manager/admin get the navigation CTA (setup surfaces are admin-gated).
  const navigate = useNavigate();
  const checkoutReadinessQuery = trpc.setupReadiness.checkout.useQuery(
    { siteId: currentSite?.id ?? '' },
    { enabled: !!currentSite, staleTime: 60_000 }
  );
  const canNavigateToSetup = user?.role === 'admin' || user?.role === 'manager';
  const checkoutReadinessItems = useMemo<PreflightItem[]>(() => {
    const items = checkoutReadinessQuery.data?.items;
    if (!items || items.length === 0) return [];
    const preflightId: Record<string, PreflightBlockerId> = {
      fiscal: 'fiscal_not_active',
      receipt_hardware: 'receipt_hardware_missing',
      payment_rail: 'payment_rail_missing',
      sync: 'sync_backlog',
    };
    return items.map(item => {
      const id = preflightId[item.id] ?? 'sync_backlog';
      const href = item.cta
        ? item.cta.tab
          ? `${item.cta.route}?tab=${item.cta.tab}`
          : item.cta.route
        : null;
      return {
        id,
        severity: item.severity,
        messageKey: `preflight.items.${id}.message`,
        recoveryAction:
          href && canNavigateToSetup
            ? {
                labelKey: `preflight.items.${id}.recovery`,
                onClick: () => navigate(href),
              }
            : undefined,
      };
    });
  }, [checkoutReadinessQuery.data, canNavigateToSetup, navigate]);

  const sales = (salesQuery.data?.items ?? []) as Sale[];
  const customers = ((customersQuery.data?.items ?? []) as Customer[]).filter(
    customer => customer.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );
  const registerAssignments =
    (registerAssignmentsQuery.data as RegisterAssignment[] | undefined) ?? [];
  const selectedRegisterAssignment =
    registerAssignments.find(assignment => {
      if (activeCashSession) {
        return assignment.registerName === activeCashSession.registerName;
      }

      return false;
    }) ??
    registerAssignments.find(assignment => assignment.id === selectedRegisterAssignmentId) ??
    registerAssignments.find(assignment => !assignment.isOccupied) ??
    registerAssignments[0] ??
    null;
  const hasActiveCashSession = !!activeCashSession;
  const hasAvailableRegisterAssignment =
    !!selectedRegisterAssignment && !selectedRegisterAssignment.isOccupied;
  const canOpenCashSession =
    !!currentSite &&
    !hasActiveCashSession &&
    !activeCashSessionQuery.isLoading &&
    !registerAssignmentsQuery.isLoading &&
    hasAvailableRegisterAssignment;

  // /  — role-aware cash drawer kick. `hasRegisteredDrawer` is
  // derived here from the shared peripherals query and passed into
  // `useCashDrawerController`; the button is hidden unless a drawer is
  // registered and the actor has a sales role (cashiers escalate separately).
  const hasRegisteredDrawer = !!peripheralsForSiteQuery.data?.find(
    r => r.kind === 'cash_drawer' && r.driver === 'escpos'
  );
  // barcode scanner pipeline. `scannerConfig` is derived from
  // the shared peripherals query and passed into `useBarcodeProductScanner`;
  // GS1 weight/price-embedded labels override quantity / unitPrice
  // server-side so the cart line reflects the weighed package.
  const scannerConfig: WedgeConfig = (() => {
    const row = peripheralsForSiteQuery.data?.find(
      r => r.kind === 'scanner' && r.driver === 'wedge'
    );
    if (!row) return DEFAULT_WEDGE_CONFIG;
    const cfg = row.config as Partial<WedgeConfig> | null;
    return {
      ...DEFAULT_WEDGE_CONFIG,
      ...(cfg ?? {}),
    };
  })();

  return {
    salesQuery,
    activeCashSessionQuery,
    maybeAutoPrint,
    sales,
    customers,
    categories,
    providers,
    registerAssignments,
    selectedRegisterAssignment,
    activeCashSession,
    hasActiveCashSession,
    canOpenCashSession,
    suspendedDraftsCount,
    checkoutReadinessItems,
    hasRegisteredDrawer,
    scannerConfig,
  };
}
