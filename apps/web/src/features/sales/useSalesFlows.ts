import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { invalidateGroups, SERIAL_INVENTORY_INVALIDATIONS } from '@/lib/invalidateGroups';
import { translateServerError } from '@/lib/translateServerError';
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
 * Params for {@link useSalesFlows}.
 *
 * slice 16 — the coupled sale-lifecycle flow handlers (checkout,
 * suspend, resume, new/select workspace) were extracted verbatim from
 * SalesPage. ALL shared state stays in the shell; the read values + the raw
 * useState setters + the five mutation handles are injected so the dependency
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
  isResumedCart: boolean;
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
  isResumedCart,
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
}: UseSalesFlowsParams) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

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
      const grandTotal = draftSummary.total + tipAmount + serviceChargeAmount;
      const payment = getCheckoutPaymentState(values, grandTotal);
      // resumed carts complete via `sales.completeDraft` so
      // we do not re-send items (locked at create-time) and do not
      // double-debit stock. Fresh carts continue on the classic
      // `sales.create` path.
      // /  — admin override for the credit-limit invariant.
      // Split-credit can demote the legacy paymentMethod to cash/card, so the
      // forwarding decision must inspect the modal tenders instead of only
      // the dominant legacy method. The server accepts direct admin authority
      // or atomically consumes an exact credit_override grant for non-admins.
      const creditOverride =
        values.creditOverride && checkoutUsesCreditTender(values) ? true : undefined;

      if (activeWorkspace?.serverSaleId) {
        await completeDraftMutation.mutateAsync({
          saleId: activeWorkspace.serverSaleId,
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
          checkoutStartedAt: activeWorkspace.checkoutStartedAt ?? undefined,
        });
        return;
      }

      await createMutation.mutateAsync({
        customerId: values.customerId || undefined,
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          serialIds: item.serialIds ?? [],
        })),
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
        checkoutStartedAt: activeWorkspace?.checkoutStartedAt ?? undefined,
      });
    } catch (error) {
      setSaleError(translateServerError(error, t, t('errors:server.unknown')));
    }
  };

  // multi-cart orchestration.
  const handleOpenSuspendPrompt = () => {
    if (!canCharge || isResumedCart) {
      return;
    }
    setSuspendLabelDraft('');
    setIsSuspendLabelPromptOpen(true);
  };

  const handleSuspendConfirm = async () => {
    if (isSuspending) {
      return;
    }
    if (cartItems.length === 0 || !ownerKey || !canCharge) {
      setIsSuspendLabelPromptOpen(false);
      return;
    }
    setIsSuspending(true);
    // Track the draft id across the two-step orchestration so we can
    // compensate if step 2 fails: the server already created the row
    // + debited stock in step 1, and a lingering orphan draft
    // (status='draft', suspendedAt=null) would never surface in
    // `sales.listDrafts` (which filters `suspended_at IS NOT NULL`).
    let pendingDraftId: string | null = null;
    try {
      const draft = await createMutation.mutateAsync({
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          serialIds: item.serialIds ?? [],
        })),
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });
      pendingDraftId = draft.id;
      // `status !== 'completed'` short-circuits the create epilogue so
      // we now own the workspace reset + invalidations + toast.
      const label = suspendLabelDraft.trim();
      await suspendMutation.mutateAsync({
        saleId: draft.id,
        label: label.length > 0 ? label : undefined,
      });
      // Success — clear the tracker so the catch block does not try to
      // discard an already-suspended draft.
      pendingDraftId = null;
      await invalidateGroups(utils, [
        u => u.sales.list,
        u => u.sales.listDrafts,
        u => u.sales.summary,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
        ...SERIAL_INVENTORY_INVALIDATIONS,
      ]);
      const storeState = useCartWorkspaceStore.getState();
      if (storeState.activeId) {
        storeState.removeWorkspace(storeState.activeId);
      }
      if (ownerKey) {
        storeState.createDraft(ownerKey);
      }
      setIsSuspendLabelPromptOpen(false);
      setSuspendLabelDraft('');
      toast.success({ title: t('park.toastSuspendTitle') });
    } catch (error) {
      toast.error({
        title: t('park.toastErrorTitle'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
      // Compensate: step 1 succeeded (stock already debited) but
      // step 2 threw. Discard the orphan so 's reversal
      // loop returns the items to stock — otherwise the cashier
      // would permanently leak inventory with no UI path to
      // recover (listDrafts filters out non-suspended drafts).
      if (pendingDraftId) {
        try {
          await discardDraftMutation.mutateAsync({
            saleId: pendingDraftId,
          });
          await invalidateGroups(utils, [
            u => u.inventory.listStock,
            u => u.products.list,
            u => u.products.search,
            ...SERIAL_INVENTORY_INVALIDATIONS,
          ]);
        } catch {
          // Best-effort: the original error is the one the
          // cashier needs to see. Swallowing a second failure
          // here avoids layering a cleanup-failed toast on top.
        }
      }
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

  const handleResumeFromPanel = async (draft: { id: string }) => {
    // A double-click on the panel row would resume the same draft twice
    // and hydrate two workspaces pointing at one serverSaleId — charging
    // both would completeDraft the same sale twice.
    if (resumeMutation.isPending) {
      return;
    }
    try {
      const resumed = await resumeMutation.mutateAsync({ saleId: draft.id });
      if (!ownerKey) {
        return;
      }
      const label = resumed.suspendedLabel ?? null;
      // Map the server-side items back into `SaleCartItem` shape so
      // the existing cart components keep rendering them unchanged.
      const items: SaleCartItem[] = (resumed.items ?? []).map(row => ({
        key: getCartItemKey(row.productId, row.unitId ?? ''),
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
        sellByFraction: false,
        fractionStep: null,
        fractionMinimum: null,
        tracksSerials: false,
        serialIds: [],
      }));
      useCartWorkspaceStore.getState().hydrateFromResumed({
        ownerKey,
        serverSaleId: resumed.id,
        serverSaleNumber: resumed.saleNumber,
        serverCustomerId: resumed.customerId ?? null,
        label,
        items,
      });
      setIsSuspendedPanelOpen(false);
      toast.success({ title: t('park.toastResumeTitle') });
    } catch (error) {
      toast.error({
        title: t('park.toastErrorTitle'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
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
