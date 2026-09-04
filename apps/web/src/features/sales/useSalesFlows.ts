import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { isPriceTier } from '@puntovivo/shared/price-tier';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import {
  invalidateCommittedGroups,
  INVENTORY_RESERVATION_INVALIDATIONS,
} from '@/lib/invalidateGroups';
import { translateServerError } from '@/lib/translateServerError';
import { normalizeRestaurantGuestCount } from '@/features/restaurants/restaurantDraft';
import { getCartItemKey, type SaleCartItem, type SaleCartSummary } from '@/features/sales/saleCart';
import {
  checkoutUsesCreditTender,
  getCheckoutPaymentState,
} from '@/features/sales/checkoutPayment';
import { useCartWorkspaceStore, type CartWorkspace } from '@/features/sales/useCartWorkspaceStore';
import { type SalePaymentValues } from '@/features/sales/SalePaymentModal';
import type { useSalesMutations } from '@/features/sales/useSalesMutations';

/** Mutation handles owned by {@link useSalesMutations}; the shell threads the
 * subset the flow handlers need so this hook never imports the mutation hook at
 * runtime (type-only edge, keeping the shell → hook → shell DAG acyclic). */
type SalesMutationHandles = ReturnType<typeof useSalesMutations>;

/**
 * Stable recovery context captured by the suspended-sales panel before
 * `sales.resume` clears the server-side suspension metadata. The original
 * label is required to restore a draft if local workspace hydration fails;
 * `tableId` keeps restaurant recovery bound to the same physical table.
 */
export interface ResumeDraftSelection {
  id: string;
  label: string | null;
  tableId: string | null;
  suspendedAt: string | null;
  resumedDeviceId: string | null;
}

/**
 * Params for {@link useSalesFlows}.
 *
 * The coupled sale-lifecycle flow handlers (checkout, suspend, resume and
 * new/select workspace) are kept together here.
 * SalesPage. ALL shared state stays in the shell; the read values + the raw
 * useState setters + the mutation handles are injected so the dependency
 * direction stays shell → hook (deps in) and hook → shell (setter calls out),
 * never hook ↔ hook. The create→suspend→(compensate discard) sequence and the
 * resume→hydrate path live together here so the coupling stays intra-module.
 */
export interface UseSalesFlowsParams {
  /** Active workspace; `serverSaleId` drives the fresh-vs-resumed checkout branch. */
  activeWorkspace: CartWorkspace | null;
  cartItems: SaleCartItem[];
  /** `${tenantId}:${userId}` or null when signed out — drives the workspace reset/hydrate. */
  ownerKey: string | null;
  draftSummary: SaleCartSummary;
  isSuspending: boolean;
  suspendLabelDraft: string;
  canCharge: boolean;
  /** Resumed drafts and accepted quotations cannot change commercial lines. */
  itemsLocked: boolean;
  setSaleError: Dispatch<SetStateAction<string | null>>;
  setIsSuspendLabelPromptOpen: Dispatch<SetStateAction<boolean>>;
  setSuspendLabelDraft: Dispatch<SetStateAction<string>>;
  setIsSuspending: Dispatch<SetStateAction<boolean>>;
  setIsSuspendedPanelOpen: Dispatch<SetStateAction<boolean>>;
  createMutation: SalesMutationHandles['createMutation'];
  completeDraftMutation: SalesMutationHandles['completeDraftMutation'];
  suspendMutation: SalesMutationHandles['suspendMutation'];
  resumeMutation: SalesMutationHandles['resumeMutation'];
  discardDraftMutation: SalesMutationHandles['discardDraftMutation'];
  openRestaurantCheckMutation: SalesMutationHandles['openRestaurantCheckMutation'];
}

/**
 * Owns the coupled sale-lifecycle flow handlers for SalesPage: checkout (fresh
 * `sales.create` vs resumed `sales.completeDraft`), the two-phase suspend
 * (create-draft → suspend, with discard-draft compensation), resume (+ hydrate
 * the workspace from the server rows), and the new/select workspace helpers.
 * Reads shared state + the mutation handles as params; the handlers stay plain
 * (non-memoized) closures, matching their prior shell form.
 */
export function useSalesFlows({
  activeWorkspace,
  cartItems,
  ownerKey,
  draftSummary,
  isSuspending,
  suspendLabelDraft,
  canCharge,
  itemsLocked,
  setSaleError,
  setIsSuspendLabelPromptOpen,
  setSuspendLabelDraft,
  setIsSuspending,
  setIsSuspendedPanelOpen,
  createMutation,
  completeDraftMutation,
  suspendMutation,
  resumeMutation,
  discardDraftMutation,
  openRestaurantCheckMutation,
}: UseSalesFlowsParams) {
  const { t } = useTranslation([
    'sales',
    'promotions',
    'customers',
    'quotationPayablesErrors',
    'returnErrors',
    'restaurants',
    'errors',
    'common',
    'fulfillmentErrors',
  ]);
  const toast = useToast();
  const utils = trpc.useUtils();
  // A resume response may arrive after logout, tenant switching, or page
  // teardown. A render-time ref plus unmount cleanup prevents that stale
  // response from rehydrating the previous operator's cart into the next
  // session. The server command is compensated below when this guard trips.
  const liveOwnerKeyRef = useRef(ownerKey);
  useEffect(() => {
    liveOwnerKeyRef.current = ownerKey;
    return () => {
      liveOwnerKeyRef.current = null;
    };
  }, [ownerKey]);

  const handleCheckout = async (values: SalePaymentValues) => {
    // Defense in depth behind the modal's own isSaving guard: each
    // mutate() mints a fresh idempotency envelope, so a second concurrent
    // fire would complete the sale twice server-side.
    if (!canCharge || createMutation.isPending || completeDraftMutation.isPending) {
      return;
    }
    try {
      // tip rolls into total server-side; we pass it through
      // unchanged. `tipMethod` is normalized to `undefined` when the
      // operator did not capture a tip so the Zod refinement on the
      // server (method requires positive amount) does not fire on the
      // happy default path. `getCheckoutPaymentState` reads its `total`
      // arg as the customer-facing grand total (the value compared
      // against `amountReceived` to compute paymentStatus), so we add
      // the tip in here before forwarding.
      const tipAmount = Math.max(0, values.tipAmount ?? 0);
      const tipMethod = tipAmount > 0 ? (values.tipMethod ?? 'fixed') : undefined;
      // service charge is auto-applied from the tenant rate
      // (resolved by SalePaymentModal); we forward whatever the modal
      // produced. `serviceChargeRate: null` → `undefined` so the Zod
      // optional() schema accepts the no-charge path without firing
      // the refinement.
      const serviceChargeAmount = Math.max(0, values.serviceChargeAmount ?? 0);
      const serviceChargeRate =
        values.serviceChargeRate != null && values.serviceChargeRate > 0
          ? values.serviceChargeRate
          : undefined;
      // A promotions-aware checkout prices from the server quote, not from
      // the pre-promotion cart summary. The fingerprint remains the commit
      // authority; this paired total is used only to derive legacy payment
      // status/amount fields without accidentally charging the old total.
      const checkoutBaseTotal = values.promotionTotal ?? draftSummary.total;
      const grandTotal = checkoutBaseTotal + tipAmount + serviceChargeAmount;
      const payment = getCheckoutPaymentState(values, grandTotal);
      // resumed carts complete via `sales.completeDraft` so
      // we do not re-send items (locked at create-time) and do not
      // double-debit stock. Fresh carts continue on the classic
      // `sales.create` path.
      // Explicit admin override for the credit-limit invariant.
      // Split-credit can demote the legacy paymentMethod to cash/card, so the
      // forwarding decision must inspect the modal tenders instead of only
      // the dominant legacy method. The server accepts direct admin authority
      // or atomically consumes an exact credit_override grant for non-admins.
      const creditOverride =
        values.creditOverride && checkoutUsesCreditTender(values) ? true : undefined;
      const frozenQuotationCustomerId = activeWorkspace?.sourceQuotationId
        ? activeWorkspace.sourceQuotationCustomerId
        : undefined;
      const frozenReturnCustomerId = activeWorkspace?.sourceReturnId
        ? activeWorkspace.sourceReturnCustomerId
        : undefined;

      if (activeWorkspace?.serverSaleId) {
        await completeDraftMutation.mutateAsync({
          saleId: activeWorkspace.serverSaleId,
          priceTier: activeWorkspace.priceTier,
          // a suspended change is created without a customer, and
          // this drawer is the only place to attach one; before this the
          // pick was dropped and the sale filed as a walk-in. Empty maps to
          // undefined (keep the draft's value) rather than null (clear it):
          // the drawer does not preload the draft's stored customer, so a
          // null here would silently detach one that was already set.
          customerId: values.customerId || undefined,
          paymentMethod: payment.paymentMethod,
          paymentStatus: payment.paymentStatus,
          amountReceived: payment.amountReceived,
          notes: values.notes || undefined,
          payments: payment.payments,
          tipAmount,
          tipMethod,
          serviceChargeAmount,
          serviceChargeRate,
          creditOverride,
          approvalRequests: values.approvalRequests,
          pharmacyEvidenceIds: values.pharmacyEvidenceIds ?? [],
          checkoutStartedAt: activeWorkspace.checkoutStartedAt ?? undefined,
          ...(values.promotionFingerprint
            ? { promotionFingerprint: values.promotionFingerprint }
            : {}),
        });
        return;
      }

      await createMutation.mutateAsync({
        customerId: activeWorkspace?.sourceQuotationId
          ? (frozenQuotationCustomerId ?? undefined)
          : activeWorkspace?.sourceReturnId
            ? (frozenReturnCustomerId ?? undefined)
            : values.customerId || undefined,
        priceTier: activeWorkspace?.priceTier ?? 1,
        items: cartItems.map(item => ({
          ...(item.sourceQuotationItemId
            ? { sourceQuotationItemId: item.sourceQuotationItemId }
            : {}),
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          serialIds: item.serialIds ?? [],
          ...(item.taxComponents && item.taxComponents.length > 0
            ? { taxComponents: item.taxComponents }
            : {}),
        })),
        ...(activeWorkspace?.sourceQuotationId
          ? { sourceQuotationId: activeWorkspace.sourceQuotationId }
          : {}),
        ...(activeWorkspace?.sourceReturnId
          ? { sourceReturnId: activeWorkspace.sourceReturnId }
          : {}),
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.paymentStatus,
        status: 'completed',
        amountReceived: payment.amountReceived,
        discountAmount: 0,
        notes: values.notes || undefined,
        // split-tender list, or undefined on the
        // legacy single-tender path. Shape is owned by `getCheckoutPaymentState`
        // so the "is-this-a-split?" decision lives in exactly one place.
        payments: payment.payments,
        tipAmount,
        tipMethod,
        serviceChargeAmount,
        serviceChargeRate,
        creditOverride,
        approvalRequests: values.approvalRequests,
        pharmacyEvidenceIds: values.pharmacyEvidenceIds ?? [],
        checkoutStartedAt: activeWorkspace?.checkoutStartedAt ?? undefined,
        ...(values.promotionFingerprint
          ? { promotionFingerprint: values.promotionFingerprint }
          : {}),
      });
    } catch (error) {
      setSaleError(translateServerError(error, t, t('errors:server.unknown')));
    }
  };

  // multi-cart orchestration.
  const handleOpenSuspendPrompt = () => {
    // Exchange provenance currently lives on the local workspace and is
    // committed atomically only with the replacement sale. Parking it as a
    // generic server draft would discard sourceReturnId, so fail closed until
    // draft rows can persist that relationship explicitly.
    if (!canCharge || itemsLocked || activeWorkspace?.sourceReturnId) {
      return;
    }
    setSuspendLabelDraft('');
    setIsSuspendLabelPromptOpen(true);
  };

  const handleSuspendConfirm = async (restaurant?: {
    tableId: string;
    guestCount: number;
    reservation?: { id: string; expectedVersion: number } | undefined;
  }) => {
    if (isSuspending) {
      return false;
    }
    if (
      cartItems.length === 0 ||
      !ownerKey ||
      !canCharge ||
      itemsLocked ||
      activeWorkspace?.sourceReturnId
    ) {
      setIsSuspendLabelPromptOpen(false);
      return true;
    }
    setIsSuspending(true);
    // Track the draft id across the two-step orchestration so we can
    // compensate if step 2 fails: the server already created the row
    // and debited stock in step 1. Recovery can surface and rebind the
    // active claim, but compensating immediately avoids leaving reserved
    // inventory behind and requiring a later operator recovery.
    let pendingDraftId: string | null = null;
    try {
      try {
        const draftItems = cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          serialIds: item.serialIds ?? [],
          ...(item.taxComponents && item.taxComponents.length > 0
            ? { taxComponents: item.taxComponents }
            : {}),
        }));
        const label = suspendLabelDraft.trim();
        if (restaurant) {
          const guestCount = normalizeRestaurantGuestCount(restaurant.guestCount);
          await openRestaurantCheckMutation.mutateAsync({
            tableId: restaurant.tableId,
            reservation: restaurant.reservation,
            guestCount,
            priceTier: activeWorkspace?.priceTier ?? 1,
            checkLabel: label.length > 0 ? label : undefined,
            diners: Array.from({ length: guestCount }, (_, index) => ({
              clientId: `seat-${index + 1}`,
              seatNumber: index + 1,
            })),
            items: draftItems.map(item => ({
              ...item,
              // The traditional POS does not ask which diner owns each line.
              // Preserve that fact instead of falsely assigning every item to
              // seat one; Voice Ordering supplies an explicit seat selection.
              dinerClientId: null,
              courseKey: 'main' as const,
              modifiers: [],
            })),
          });
        } else {
          const draft = await createMutation.mutateAsync({
            priceTier: activeWorkspace?.priceTier ?? 1,
            items: draftItems,
            paymentMethod: 'cash',
            paymentStatus: 'pending',
            status: 'draft',
            discountAmount: 0,
          });
          pendingDraftId = draft.id;
          await suspendMutation.mutateAsync({
            saleId: draft.id,
            label: label.length > 0 ? label : undefined,
          });
          pendingDraftId = null;
        }
      } catch (error) {
        let compensationFailed = false;
        // Compensate: step 1 succeeded (stock already debited) but
        // step 2 threw. Discard the partial draft so the reversal loop
        // returns the items to stock immediately instead of relying on
        // the active-claim recovery flow after a later reload.
        if (pendingDraftId) {
          try {
            await discardDraftMutation.mutateAsync({
              saleId: pendingDraftId,
            });
            await invalidateCommittedGroups(utils, INVENTORY_RESERVATION_INVALIDATIONS);
          } catch {
            compensationFailed = true;
          }
        }
        toast.error({
          title: t('park.toastErrorTitle'),
          description: compensationFailed
            ? t('park.suspendRecoveryFailedDescription')
            : translateServerError(error, t, t('errors:server.unknown')),
        });
        return false;
      }

      // The command above is durable. Clear the local cart before refreshing
      // derived queries so a cache failure can never invite a duplicate park.
      const storeState = useCartWorkspaceStore.getState();
      if (storeState.activeId) {
        storeState.removeWorkspace(storeState.activeId);
      }
      if (ownerKey) {
        storeState.createDraft(ownerKey);
      }
      setIsSuspendLabelPromptOpen(false);
      setSuspendLabelDraft('');
      const refreshed = await invalidateCommittedGroups(utils, [
        u => u.sales.list,
        u => u.sales.listDrafts,
        u => u.sales.summary,
        u => u.restaurantTables.listWithDraftStatus,
        u => u.restaurantServices.getTableState,
        u => u.reservations.list,
        ...INVENTORY_RESERVATION_INVALIDATIONS,
      ]);
      if (refreshed) {
        toast.success({ title: t('park.toastSuspendTitle') });
      } else {
        toast.warning({
          title: t('park.toastSuspendTitle'),
          description: t('common:toast.committedRefreshWarning'),
        });
      }
      return true;
    } finally {
      setIsSuspending(false);
    }
  };

  const handleNewSale = () => {
    if (!ownerKey) {
      return;
    }
    // Spawn a fresh blank workspace and set it active. The previous
    // cart stays in the store so the cashier can switch back to it
    // later; if they want it on the server they hit Suspend instead.
    useCartWorkspaceStore.getState().createDraft(ownerKey);
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    useCartWorkspaceStore.getState().setActive(workspaceId);
  };

  const handleResumeFromPanel = async (draft: ResumeDraftSelection) => {
    // A double-click on the panel row would resume the same draft twice
    // and hydrate two workspaces pointing at one serverSaleId — charging
    // both would completeDraft the same sale twice.
    const requestedOwnerKey = liveOwnerKeyRef.current;
    if (resumeMutation.isPending || !requestedOwnerKey) {
      return;
    }
    // Device ownership is not snapshot freshness: another terminal can split
    // or reassign a check. Resume always reads the authoritative lines; the
    // server makes an already-owned claim a no-op for audit/outbox effects.
    let resumed: Awaited<ReturnType<typeof resumeMutation.mutateAsync>>;
    try {
      resumed = await resumeMutation.mutateAsync({ saleId: draft.id });
    } catch (error) {
      toast.error({
        title: t('park.toastErrorTitle'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
      return;
    }
    const restoreSuspensionAfterLocalFailure = async () => {
      // Zustand persistence can throw after applying an in-memory update. Drop
      // only workspaces tied to this server draft before restoring suspension,
      // otherwise the screen could retain a chargeable cart whose server row
      // is parked again.
      try {
        const workspaceState = useCartWorkspaceStore.getState();
        for (const workspace of Object.values(workspaceState.workspaces)) {
          if (workspace.serverSaleId === resumed.id) {
            workspaceState.removeWorkspace(workspace.id);
          }
        }
      } catch {
        // Best-effort local cleanup. The authoritative recovery below remains
        // the safety boundary even when browser storage itself is unavailable.
      }

      try {
        await suspendMutation.mutateAsync({
          saleId: resumed.id,
          ...(draft.label ? { label: draft.label } : {}),
          ...(draft.tableId ? { tableId: draft.tableId } : {}),
        });
        const refreshed = await invalidateCommittedGroups(utils, [
          u => u.sales.listDrafts,
          u => u.restaurantTables.listWithDraftStatus,
          u => u.restaurantServices.getTableState,
        ]);
        toast.error({
          title: t('park.toastErrorTitle'),
          description: refreshed
            ? t('park.resumeRestoredDescription')
            : `${t('park.resumeRestoredDescription')} ${t('common:toast.committedRefreshWarning')}`,
        });
      } catch {
        // `sales.resume` is already durable. Be explicit that recreating the
        // order would risk a duplicate; a reload/recovery action is safer than
        // presenting this as an ordinary retryable failure.
        toast.error({
          title: t('park.toastErrorTitle'),
          description: t('park.resumeRecoveryFailedDescription'),
        });
      }
    };

    if (liveOwnerKeyRef.current !== requestedOwnerKey) {
      await restoreSuspensionAfterLocalFailure();
      return;
    }
    try {
      // `sales.resume` intentionally clears its suspension fields. Preserve
      // the panel snapshot so the active workspace still names the table or
      // customer the operator selected.
      const label = draft.label;
      // Map the server-side items back into `SaleCartItem` shape so
      // the existing cart components keep rendering them unchanged.
      const items: SaleCartItem[] = (resumed.items ?? []).map(row => ({
        // Duplicate product/unit lines are legal (for example differently
        // priced GS1 packages). The frozen server item id keeps their React
        // and cart-action identities distinct after suspend/resume.
        key: `${getCartItemKey(row.productId, row.unitId ?? '')}:server:${row.id}`,
        productId: row.productId,
        productName: row.productName ?? row.productId,
        productSku: row.productSku ?? '',
        unitId: row.unitId ?? '',
        unitName: row.unitName ?? row.unitAbbreviation ?? row.unitId ?? '',
        unitEquivalence: row.unitEquivalence ?? 1,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        discount: row.discount,
        taxRate: row.taxRate,
        availableStock: Number.POSITIVE_INFINITY,
        // Resumed lines carry the server's flag so a service line keeps
        // its no-stock semantics through suspend and resume.
        tracksStock: row.tracksStock !== false,
        sellByFraction: false,
        fractionStep: null,
        fractionMinimum: null,
        tracksSerials: false,
        serialIds: [],
        // Hint the payment UI to request the exact manager grant. The server
        // independently derives the override from frozen catalog snapshots.
        priceEdited: row.priceEdited,
      }));
      useCartWorkspaceStore.getState().hydrateFromResumed({
        ownerKey: requestedOwnerKey,
        serverSaleId: resumed.id,
        serverSaleNumber: resumed.saleNumber,
        serverCustomerId: resumed.customerId ?? null,
        priceTier: isPriceTier(resumed.priceTier) ? resumed.priceTier : 1,
        label,
        items,
      });
      setIsSuspendedPanelOpen(false);
      const refreshed = await invalidateCommittedGroups(utils, [
        u => u.sales.listDrafts,
        u => u.restaurantTables.listWithDraftStatus,
        u => u.restaurantServices.getTableState,
      ]);
      if (refreshed) {
        toast.success({ title: t('park.toastResumeTitle') });
      } else {
        toast.warning({
          title: t('park.toastResumeTitle'),
          description: t('common:toast.committedRefreshWarning'),
        });
      }
    } catch {
      // Hydration is local-only but the server command is already committed.
      // Put the draft back into its recoverable suspended state rather than
      // leaving an invisible stock-debiting sale after a storage/render error.
      await restoreSuspensionAfterLocalFailure();
    }
  };

  return {
    handleCheckout,
    handleOpenSuspendPrompt,
    handleSuspendConfirm,
    handleNewSale,
    handleSelectWorkspace,
    handleResumeFromPanel,
  };
}
