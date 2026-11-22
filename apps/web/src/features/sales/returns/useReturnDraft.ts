import { useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { Sale, SaleItem } from '@/types';

export type ReturnDestination = 'original' | 'store_credit';

export interface ReturnItemSubmission {
  saleItemId: string;
  quantity: number;
  lotAllocations?: Array<{ saleItemLotId: string; quantity: number }> | undefined;
  serialIds?: string[] | undefined;
}

export const RETURN_EPSILON = 1e-8;
const EPSILON = RETURN_EPSILON;

export function lineRemaining(line: SaleItem): number {
  return Math.max(0, Number(line.remainingQuantity ?? line.quantity));
}

export function lineBaseQuantity(line: SaleItem, quantity: number): number {
  return quantity * Number(line.unitEquivalence ?? 1);
}

/** The name frozen on the sale, so a later catalog rename never changes the receipt. */
export function lineName(line: SaleItem): string {
  return line.productNameSnapshot ?? line.productName ?? line.productId;
}

export interface LineSelection {
  quantity: number;
  lots: Record<string, number>;
  serials: string[];
}

/** A new quantity takes lots oldest first and the first serials not yet returned. */
function selectQuantity(line: SaleItem, quantity: number): LineSelection {
  const base = lineBaseQuantity(line, quantity);
  let remaining = base;
  const lots: Record<string, number> = {};
  for (const lot of line.lots ?? []) {
    if (remaining <= EPSILON) break;
    const allocated = Math.min(Number(lot.remainingQuantity), remaining);
    if (allocated > EPSILON) lots[lot.id] = allocated;
    remaining -= allocated;
  }
  const serials = Number.isInteger(base)
    ? (line.serials ?? [])
        .filter(serial => !serial.returned)
        .slice(0, base)
        .map(serial => serial.productSerialId)
    : [];
  return { quantity, lots, serials };
}

/** Which lines, how much of each, and which lots or serials go back. */
export function useReturnSelection(
  sale: Sale | undefined,
  options: {
    initialLines?: Record<string, LineSelection> | undefined;
    /** A one-line receipt at the till has nothing to choose. */
    preselectSingleLine?: boolean | undefined;
  } = {}
) {
  const { initialLines = {}, preselectSingleLine = false } = options;
  const returnableLines = useMemo(
    () => (sale?.items ?? []).filter(line => lineRemaining(line) > EPSILON),
    [sale?.items]
  );
  const [selection, setSelection] = useState<Record<string, LineSelection>>(() => {
    const remembered = returnableLines.filter(line => initialLines[line.id] !== undefined);
    if (remembered.length > 0) {
      return Object.fromEntries(
        remembered.map(line => {
          const saved = initialLines[line.id]!;
          // Keep the picked lots and serials unless the line shrank since.
          return [
            line.id,
            saved.quantity - lineRemaining(line) > EPSILON
              ? selectQuantity(line, lineRemaining(line))
              : saved,
          ];
        })
      );
    }
    const [only] = returnableLines;
    return preselectSingleLine && returnableLines.length === 1 && only
      ? { [only.id]: selectQuantity(only, lineRemaining(only)) }
      : {};
  });

  const setLine = (line: SaleItem, next: LineSelection | null) =>
    setSelection(current => {
      const copy = { ...current };
      if (next) copy[line.id] = next;
      else delete copy[line.id];
      return copy;
    });

  const selectLine = (line: SaleItem, selected: boolean) =>
    setLine(line, selected ? selectQuantity(line, lineRemaining(line)) : null);

  const updateLineQuantity = (line: SaleItem, value: number) =>
    setLine(
      line,
      selectQuantity(
        line,
        Number.isFinite(value) ? Math.min(lineRemaining(line), Math.max(0, value)) : 0
      )
    );

  const selectAll = () =>
    setSelection(
      Object.fromEntries(
        returnableLines.map(line => [line.id, selectQuantity(line, lineRemaining(line))])
      )
    );

  const clear = () => setSelection({});

  const setLotQuantity = (line: SaleItem, lotId: string, value: number, max: number) => {
    const current = selection[line.id];
    if (!current) return;
    setLine(line, {
      ...current,
      lots: {
        ...current.lots,
        [lotId]: Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0,
      },
    });
  };

  const toggleSerial = (line: SaleItem, productSerialId: string, checked: boolean) => {
    const current = selection[line.id];
    if (!current) return;
    setLine(line, {
      ...current,
      serials: checked
        ? [...current.serials, productSerialId]
        : current.serials.filter(id => id !== productSerialId),
    });
  };

  const selectedQuantities = useMemo(
    () => Object.fromEntries(Object.entries(selection).map(([id, line]) => [id, line.quantity])),
    [selection]
  );

  const selectedItems = useMemo<ReturnItemSubmission[]>(
    () =>
      returnableLines.flatMap(line => {
        const picked = selection[line.id];
        if (!picked || !Number.isFinite(picked.quantity) || picked.quantity <= EPSILON) return [];
        return [
          {
            saleItemId: line.id,
            quantity: picked.quantity,
            ...((line.lots?.length ?? 0) > 0
              ? {
                  lotAllocations: Object.entries(picked.lots)
                    .filter(([, amount]) => amount > EPSILON)
                    .map(([saleItemLotId, amount]) => ({ saleItemLotId, quantity: amount })),
                }
              : {}),
            ...((line.serials?.length ?? 0) > 0 ? { serialIds: picked.serials } : {}),
          },
        ];
      }),
    [returnableLines, selection]
  );

  const selectionIsValid = returnableLines.every(line => {
    const picked = selection[line.id];
    if (!picked) return true;
    const { quantity } = picked;
    if (
      !Number.isFinite(quantity) ||
      quantity <= EPSILON ||
      quantity - lineRemaining(line) > EPSILON
    ) {
      return false;
    }
    const requiredBase = lineBaseQuantity(line, quantity);
    if ((line.lots?.length ?? 0) > 0) {
      const allocated = Object.values(picked.lots).reduce((sum, amount) => sum + amount, 0);
      if (Math.abs(allocated - requiredBase) > EPSILON) return false;
    }
    if ((line.serials?.length ?? 0) > 0) {
      if (!Number.isInteger(requiredBase) || picked.serials.length !== requiredBase) return false;
    }
    return true;
  });

  return {
    returnableLines,
    lines: selection,
    selectedQuantities,
    lotsFor: (lineId: string) => selection[lineId]?.lots ?? {},
    serialsFor: (lineId: string) => selection[lineId]?.serials ?? [],
    selectLine,
    updateLineQuantity,
    selectAll,
    clear,
    setLotQuantity,
    toggleSerial,
    selectedItems,
    selectionIsValid,
    canPreview: selectedItems.length > 0 && selectionIsValid,
  };
}

export type ReturnSelection = ReturnType<typeof useReturnSelection>;

/** Server preview of the refund plus the provider references its tenders need. */
export function useReturnPreview(input: {
  saleId: string | undefined;
  selection: ReturnSelection;
  destination: ReturnDestination;
}) {
  const { t } = useTranslation(['returnErrors', 'errors']);
  const { selection, destination } = input;
  const [externalReferences, setExternalReferences] = useState<Record<string, string>>({});
  const previewQuery = trpc.sales.previewReturn.useQuery(
    { id: input.saleId ?? '', items: selection.selectedItems, destination },
    {
      enabled: selection.canPreview && !!input.saleId,
      retry: false,
      staleTime: 0,
      // A quantity change keeps the last refund on screen instead of blanking it.
      placeholderData: keepPreviousData,
    }
  );
  const preview = selection.canPreview ? previewQuery.data : undefined;
  const externalAllocations = (preview?.allocations ?? []).filter(
    allocation => allocation.destination === 'external' && allocation.amount > EPSILON
  );
  const referenceKey = (allocation: (typeof externalAllocations)[number]) =>
    allocation.salePaymentId ?? `legacy:${allocation.originalMethod}`;
  const referenceRows = externalAllocations.map(allocation => ({
    salePaymentId: allocation.salePaymentId,
    reference: (externalReferences[referenceKey(allocation)] ?? '').trim(),
  }));
  const error =
    selection.canPreview && previewQuery.error
      ? translateServerError(previewQuery.error, t, t('errors:server.unknown'))
      : null;

  return {
    preview,
    refetch: previewQuery.refetch,
    isFetching: selection.canPreview && previewQuery.isFetching,
    error,
    externalAllocations,
    referenceKey,
    externalReferences,
    setExternalReference: (key: string, value: string) =>
      setExternalReferences(current => ({ ...current, [key]: value })),
    referencesAreValid: referenceRows.every(row => row.reference.length > 0),
    referenceRows,
  };
}

export type ReturnPreviewState = ReturnType<typeof useReturnPreview>;
