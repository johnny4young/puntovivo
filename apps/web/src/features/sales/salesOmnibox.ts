/**
 * shared product-to-cart helpers for the global sales omnibox.
 *
 * The command palette lives outside SalesPage, so it cannot reuse that
 * page's hook-owned cart callbacks. These helpers keep the cross-route path
 * on the same primitives as the POS: product/unit resolution flows through
 * ProductSearchSelection and cart mutations flow through mergeCartItem.
 */

import {
  applyPriceTier,
  getBarcodeCartItemKey,
  mergeBarcodeCartItem,
} from '@/features/sales/saleCart';
import { useCartWorkspaceStore } from '@/features/sales/useCartWorkspaceStore';
import type { ProductSearchItem, ProductSearchSelection, ProductUnitAssignment } from '@/types';

export interface BarcodeCartLookup {
  product: ProductSearchItem;
  resolvedUnitId: string | null;
  suggestedPrice: number | null;
  suggestedQuantity: number | null;
}

export interface ResolvedCartSelection {
  selection: ProductSearchSelection;
  quantityOverride: number | null;
  priceOverride: number | null;
}

function defaultUnit(product: ProductSearchItem): ProductUnitAssignment | null {
  const assignments = product.unitAssignments ?? [];
  return assignments.find(unit => unit.isBase) ?? assignments[0] ?? null;
}

/** Resolve a normal text/SKU search result to its default sellable unit. */
export function resolveProductCartSelection(
  product: ProductSearchItem
): ResolvedCartSelection | null {
  const unit = defaultUnit(product);
  if (!unit) return null;
  return {
    selection: {
      product,
      unit,
      price: unit.price ?? product.price,
    },
    quantityOverride: null,
    priceOverride: null,
  };
}

/**
 * Resolve an exact scanner lookup, preserving packaging-unit and GS1
 * quantity/price overrides. Shared with the /sales scanner so an omnibox
 * scan behaves exactly like a scan performed inside the checkout route.
 */
export function resolveBarcodeCartSelection(
  lookup: BarcodeCartLookup
): ResolvedCartSelection | null {
  const baseUnit = defaultUnit(lookup.product);
  if (!baseUnit) return null;
  const unit = lookup.resolvedUnitId
    ? (lookup.product.unitAssignments?.find(
        assignment => assignment.unitId === lookup.resolvedUnitId
      ) ?? baseUnit)
    : baseUnit;
  return {
    selection: {
      product: lookup.product,
      unit,
      price: lookup.suggestedPrice ?? unit.price ?? lookup.product.price,
    },
    quantityOverride: lookup.suggestedQuantity,
    priceOverride: lookup.suggestedPrice,
  };
}

export interface AddOmniboxSelectionArgs extends ResolvedCartSelection {
  ownerKey: string;
}

export interface AddOmniboxSelectionResult {
  workspaceId: string;
  itemKey: string;
}

/**
 * Add a resolved product to the current user's editable cart.
 *
 * Resumed server drafts and accepted quotations are intentionally immutable.
 * If one is active, reuse the newest ordinary local draft owned by this user
 * or create one, then make that workspace active before navigating to /sales.
 * Workspaces owned by another signed-in user are never read or mutated.
 */
export function addOmniboxSelectionToCart({
  ownerKey,
  selection,
  quantityOverride,
  priceOverride,
}: AddOmniboxSelectionArgs): AddOmniboxSelectionResult {
  const initialState = useCartWorkspaceStore.getState();
  const active = initialState.activeId
    ? (initialState.workspaces[initialState.activeId] ?? null)
    : null;
  let workspaceId =
    active?.ownerKey === ownerKey &&
    active.serverSaleId === null &&
    active.sourceQuotationId === null
      ? active.id
      : null;

  if (!workspaceId) {
    const editableOwned = Object.values(initialState.workspaces)
      .filter(
        workspace =>
          workspace.ownerKey === ownerKey &&
          workspace.serverSaleId === null &&
          workspace.sourceQuotationId === null
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    workspaceId = editableOwned?.id ?? initialState.createDraft(ownerKey);
    if (editableOwned) initialState.setActive(editableOwned.id);
  }

  const state = useCartWorkspaceStore.getState();
  const currentItems = state.workspaces[workspaceId]?.items ?? [];
  const itemKey = getBarcodeCartItemKey(selection, priceOverride);
  const nextItems = mergeBarcodeCartItem(currentItems, selection, {
    quantity: quantityOverride,
    price: priceOverride,
  });
  state.updateCart(
    workspaceId,
    applyPriceTier(nextItems, state.workspaces[workspaceId]?.priceTier ?? 1)
  );
  state.setSelectedItem(workspaceId, itemKey);
  return { workspaceId, itemKey };
}
