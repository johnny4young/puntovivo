/** Exact lot provenance for immediate/deferred inventory transfers. */

import { roundQuantity } from '@puntovivo/shared/unit-math';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { inventoryLots, transferOrderItemLots } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { tryRoundMoneyToSafeCents } from '../../lib/money.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import {
  consumeExactInventoryLots,
  receiveInventoryLot,
  restoreExactInventoryLot,
  type InventoryLotStatus,
} from '../../services/inventory-lots/index.js';
import type { TransferItemInput } from '../../services/inventory-transfers/types.js';
import { isLotExpiredAt } from '../../services/inventory-lots/expiry.js';
import {
  applyRecallCustodyOverlays,
  resolveTransferLotCustody,
} from '../../services/pharmacy/transfer-custody.js';
import type { EnqueueSyncContext } from '../../services/sync/enqueue.js';

function assertAllocationTotal(allocated: number, required: number) {
  if (Math.abs(allocated - required) > QUANTITY_EPSILON) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'LOT_ALLOCATION_QUANTITY_MISMATCH',
      message: 'Transfer lot quantities must equal the transfer line quantity',
      details: { allocated, required },
    });
  }
}

export function shipTransferItemLots(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    fromSiteId: string;
    toSiteId: string;
    transferOrderItemId: string;
    productId: string;
    quantity: number;
    allocations: TransferItemInput['lotAllocations'];
    deferred: boolean;
    now: string;
    businessDate?: string;
    actorId: string;
    syncContext: Omit<EnqueueSyncContext, 'db'>;
  }
) {
  const requested = input.allocations ?? [];
  assertAllocationTotal(
    requested.reduce((sum, allocation) => roundQuantity(sum + allocation.quantity, 12), 0),
    input.quantity
  );
  const consumed = consumeExactInventoryLots(tx, {
    tenantId: input.tenantId,
    siteId: input.fromSiteId,
    productId: input.productId,
    allocations: requested,
    now: input.now,
    ...(input.businessDate ? { businessDate: input.businessDate } : {}),
  });

  return consumed.map(source => {
    const id = nanoid();
    let destinationLotId: string | null = null;
    let destinationSnapshot: ReturnType<typeof receiveInventoryLot> | null = null;
    if (!input.deferred) {
      const custody = resolveTransferLotCustody(tx, input.tenantId, source.lotId);
      destinationSnapshot = receiveInventoryLot(tx, {
        tenantId: input.tenantId,
        siteId: input.toSiteId,
        productId: input.productId,
        lotNumber: source.lotNumber,
        expiresAt: source.expiresAt,
        quantity: source.quantity,
        unitCost: source.unitCost,
        incomingStatus: custody.incomingStatus,
        requireExactExpiry: true,
        notes: input.transferOrderItemId,
        now: input.now,
        ...(input.businessDate ? { businessDate: input.businessDate } : {}),
      });
      destinationLotId = destinationSnapshot.lotId;
      if (custody.recallOverlays.length > 0) {
        const status = applyRecallCustodyOverlays(tx, input.syncContext, {
          tenantId: input.tenantId,
          destinationLotId,
          recallOverlays: custody.recallOverlays,
          actorId: input.actorId,
          occurredAt: input.now,
        });
        destinationSnapshot = { ...destinationSnapshot, status };
      }
    }
    tx.insert(transferOrderItemLots)
      .values({
        id,
        tenantId: input.tenantId,
        transferOrderItemId: input.transferOrderItemId,
        sourceLotId: source.lotId,
        destinationLotId,
        lotNumberSnapshot: source.lotNumber,
        expiresAtSnapshot: source.expiresAt,
        sourceStatusSnapshot: source.sourceStatus,
        quantity: source.quantity,
        receivedQuantity: input.deferred ? null : source.quantity,
        unitCost: source.unitCost,
        destinationLotWasCreated: destinationSnapshot?.created ?? null,
        destinationPreviousOnHand: destinationSnapshot?.previousOnHand ?? null,
        destinationPreviousUnitCost: destinationSnapshot?.previousUnitCost ?? null,
        destinationPreviousStatus: destinationSnapshot?.previousStatus ?? null,
        destinationResultingOnHand: destinationSnapshot?.onHand ?? null,
        destinationResultingUnitCost: destinationSnapshot?.unitCost ?? null,
        destinationResultingStatus: destinationSnapshot?.status ?? null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .run();
    return {
      id,
      sourceLotId: source.lotId,
      destinationLotId,
      lotNumber: source.lotNumber,
      expiresAt: source.expiresAt,
      quantity: source.quantity,
      receivedQuantity: input.deferred ? null : source.quantity,
      status: source.sourceStatus,
      unitCost: source.unitCost,
    };
  });
}

export function receiveTransferItemLots(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    toSiteId: string;
    transferOrderItemId: string;
    productId: string;
    requested?: readonly { transferItemLotId: string; receivedQuantity: number }[] | undefined;
    now: string;
    businessDate?: string;
    actorId: string;
    syncContext: Omit<EnqueueSyncContext, 'db'>;
  }
) {
  const rows = tx
    .select()
    .from(transferOrderItemLots)
    .where(
      and(
        eq(transferOrderItemLots.tenantId, input.tenantId),
        eq(transferOrderItemLots.transferOrderItemId, input.transferOrderItemId)
      )
    )
    .all();
  if (rows.length === 0) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'The transfer line has no frozen lot provenance',
      details: { transferOrderItemId: input.transferOrderItemId },
    });
  }

  const requested =
    input.requested ??
    rows.map(row => ({
      transferItemLotId: row.id,
      receivedQuantity: row.quantity,
    }));
  const requestedIds = requested.map(row => row.transferItemLotId);
  if (new Set(requestedIds).size !== requestedIds.length || requestedIds.length !== rows.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_RECEIVE_LINE_MISMATCH',
      message: 'Every shipped lot must appear exactly once in the receipt',
    });
  }
  const requestedById = new Map(requested.map(row => [row.transferItemLotId, row]));
  const lotIds = new Set<string>();
  let receivedQuantity = 0;

  const lots = rows.map(row => {
    const receipt = requestedById.get(row.id);
    if (!receipt) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVE_LINE_MISMATCH',
        message: 'Receipt references do not match the shipped lot identities',
      });
    }
    if (
      !Number.isFinite(receipt.receivedQuantity) ||
      receipt.receivedQuantity < 0 ||
      receipt.receivedQuantity - row.quantity > QUANTITY_EPSILON
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
        message: 'Received lot quantity cannot exceed its shipped quantity',
        details: {
          transferItemLotId: row.id,
          shipped: row.quantity,
          received: receipt.receivedQuantity,
        },
      });
    }
    const normalizedReceivedQuantity =
      receipt.receivedQuantity <= QUANTITY_EPSILON
        ? 0
        : Math.abs(receipt.receivedQuantity - row.quantity) <= QUANTITY_EPSILON
          ? row.quantity
          : roundQuantity(receipt.receivedQuantity, 12);
    let destinationLotId: string | null = null;
    let destinationSnapshot: ReturnType<typeof receiveInventoryLot> | null = null;
    if (normalizedReceivedQuantity > QUANTITY_EPSILON) {
      const custody = resolveTransferLotCustody(tx, input.tenantId, row.sourceLotId);
      destinationSnapshot = receiveInventoryLot(tx, {
        tenantId: input.tenantId,
        siteId: input.toSiteId,
        productId: input.productId,
        lotNumber: row.lotNumberSnapshot,
        expiresAt: row.expiresAtSnapshot,
        quantity: normalizedReceivedQuantity,
        unitCost: row.unitCost,
        incomingStatus: custody.incomingStatus,
        requireExactExpiry: true,
        notes: input.transferOrderItemId,
        now: input.now,
        ...(input.businessDate ? { businessDate: input.businessDate } : {}),
      });
      destinationLotId = destinationSnapshot.lotId;
      if (custody.recallOverlays.length > 0) {
        const status = applyRecallCustodyOverlays(tx, input.syncContext, {
          tenantId: input.tenantId,
          destinationLotId,
          recallOverlays: custody.recallOverlays,
          actorId: input.actorId,
          occurredAt: input.now,
        });
        destinationSnapshot = { ...destinationSnapshot, status };
      }
      lotIds.add(destinationLotId);
    }
    tx.update(transferOrderItemLots)
      .set({
        destinationLotId,
        receivedQuantity: normalizedReceivedQuantity,
        destinationLotWasCreated: destinationSnapshot?.created ?? null,
        destinationPreviousOnHand: destinationSnapshot?.previousOnHand ?? null,
        destinationPreviousUnitCost: destinationSnapshot?.previousUnitCost ?? null,
        destinationPreviousStatus: destinationSnapshot?.previousStatus ?? null,
        destinationResultingOnHand: destinationSnapshot?.onHand ?? null,
        destinationResultingUnitCost: destinationSnapshot?.unitCost ?? null,
        destinationResultingStatus: destinationSnapshot?.status ?? null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(transferOrderItemLots.id, row.id),
          eq(transferOrderItemLots.tenantId, input.tenantId)
        )
      )
      .run();
    receivedQuantity = roundQuantity(receivedQuantity + normalizedReceivedQuantity, 12);
    return {
      id: row.id,
      sourceLotId: row.sourceLotId,
      destinationLotId,
      lotNumber: row.lotNumberSnapshot,
      expiresAt: row.expiresAtSnapshot,
      quantity: row.quantity,
      receivedQuantity: normalizedReceivedQuantity,
      status: row.sourceStatusSnapshot,
      unitCost: row.unitCost,
    };
  });

  return { lots, receivedQuantity, destinationLotIds: [...lotIds] };
}

export function voidTransferItemLots(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    fromSiteId: string;
    toSiteId: string;
    transferOrderItemId: string;
    productId: string;
    wasInTransit: boolean;
    now: string;
    businessDate?: string;
  }
): string[] {
  const rows = tx
    .select()
    .from(transferOrderItemLots)
    .where(
      and(
        eq(transferOrderItemLots.tenantId, input.tenantId),
        eq(transferOrderItemLots.transferOrderItemId, input.transferOrderItemId)
      )
    )
    .all();
  if (rows.length === 0) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'The transfer line has no lot provenance to reverse',
    });
  }

  const sourceLots = tx
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      expiresAt: inventoryLots.expiresAt,
    })
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.tenantId, input.tenantId),
        eq(inventoryLots.siteId, input.fromSiteId),
        eq(inventoryLots.productId, input.productId),
        inArray(
          inventoryLots.id,
          rows.map(row => row.sourceLotId)
        )
      )
    )
    .all();
  const sourceLotById = new Map(sourceLots.map(lot => [lot.id, lot]));

  const changedLotIds = new Set<string>();
  const returningStatusByRowId = new Map<string, InventoryLotStatus>();
  if (!input.wasInTransit) {
    for (const row of rows) {
      if ((row.receivedQuantity ?? 0) <= QUANTITY_EPSILON) continue;
      returningStatusByRowId.set(
        row.id,
        reverseDestinationLotReceipt(tx, {
          tenantId: input.tenantId,
          siteId: input.toSiteId,
          productId: input.productId,
          row,
          now: input.now,
          ...(input.businessDate ? { businessDate: input.businessDate } : {}),
        })
      );
      changedLotIds.add(row.destinationLotId!);
    }
  }

  for (const row of rows) {
    const returningQuantity = input.wasInTransit
      ? row.quantity
      : (row.receivedQuantity ?? row.quantity);
    if (returningQuantity <= QUANTITY_EPSILON) continue;
    const sourceLot = sourceLotById.get(row.sourceLotId);
    if (
      !sourceLot ||
      sourceLot.lotNumber !== row.lotNumberSnapshot ||
      sourceLot.expiresAt !== row.expiresAtSnapshot
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'LOT_STOCK_INCONSISTENT',
        message: 'Transfer source lot identity changed and cannot be restored exactly',
        details: { lotId: row.sourceLotId, transferItemLotId: row.id },
      });
    }
    restoreExactInventoryLot(tx, {
      tenantId: input.tenantId,
      siteId: input.fromSiteId,
      productId: input.productId,
      lotId: row.sourceLotId,
      quantity: returningQuantity,
      unitCost: row.unitCost,
      incomingStatus: input.wasInTransit
        ? row.sourceStatusSnapshot
        : (returningStatusByRowId.get(row.id) ?? row.sourceStatusSnapshot),
      now: input.now,
      ...(input.businessDate ? { businessDate: input.businessDate } : {}),
    });
    changedLotIds.add(row.sourceLotId);
  }
  return [...changedLotIds];
}

function reverseDestinationLotReceipt(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    siteId: string;
    productId: string;
    row: typeof transferOrderItemLots.$inferSelect;
    now: string;
    businessDate?: string;
  }
): InventoryLotStatus {
  const row = input.row;
  if (
    !row.destinationLotId ||
    row.destinationResultingOnHand === null ||
    row.destinationResultingUnitCost === null ||
    row.destinationLotWasCreated === null ||
    row.destinationResultingStatus === null
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'Transfer destination lot provenance is incomplete',
      details: { transferItemLotId: row.id },
    });
  }
  const lot = tx
    .select()
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.id, row.destinationLotId),
        eq(inventoryLots.tenantId, input.tenantId),
        eq(inventoryLots.siteId, input.siteId),
        eq(inventoryLots.productId, input.productId)
      )
    )
    .get();
  if (!lot) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'TRANSFER_VOID_INSUFFICIENT_STOCK',
      message: 'Destination lot no longer exists and cannot be reversed exactly',
      details: { lotId: row.destinationLotId },
    });
  }
  const currentUnitCost = tryRoundMoneyToSafeCents(lot.unitCost);
  const resultingUnitCost = tryRoundMoneyToSafeCents(row.destinationResultingUnitCost);
  const restoredOnHand = row.destinationPreviousOnHand ?? 0;
  const restoredUnitCost = tryRoundMoneyToSafeCents(
    row.destinationPreviousUnitCost ?? row.unitCost
  );
  if (
    !Number.isFinite(row.destinationResultingOnHand) ||
    row.destinationResultingOnHand < 0 ||
    !Number.isFinite(restoredOnHand) ||
    restoredOnHand < 0 ||
    !Number.isFinite(lot.onHand) ||
    lot.onHand < 0
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STOCK_INCONSISTENT',
      message: 'Transfer destination lot quantities are outside the supported range',
      details: { lotId: row.destinationLotId },
    });
  }
  if (
    currentUnitCost === null ||
    currentUnitCost < 0 ||
    resultingUnitCost === null ||
    resultingUnitCost < 0 ||
    restoredUnitCost === null ||
    restoredUnitCost < 0
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_COST_INVALID',
      message: 'Transfer destination lot costs are outside the exact supported cent range',
      details: { lotId: row.destinationLotId },
    });
  }
  if (
    lot.lotNumber !== row.lotNumberSnapshot ||
    lot.expiresAt !== row.expiresAtSnapshot ||
    Math.abs(lot.onHand - row.destinationResultingOnHand) > QUANTITY_EPSILON ||
    Math.abs(currentUnitCost - resultingUnitCost) > QUANTITY_EPSILON
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'TRANSFER_VOID_INSUFFICIENT_STOCK',
      message: 'Destination lot changed after the transfer and cannot be reversed exactly',
      details: { lotId: row.destinationLotId },
    });
  }

  const transferredStatus: InventoryLotStatus =
    lot.status === 'quarantined' || lot.status === 'expired' || lot.status === 'recalled'
      ? lot.status
      : isLotExpiredAt(lot.expiresAt, input.now, input.businessDate)
        ? 'expired'
        : 'active';
  const statusChanged = lot.status !== row.destinationResultingStatus;
  const restoredStatus = statusChanged
    ? transferredStatus === 'quarantined' ||
      transferredStatus === 'expired' ||
      transferredStatus === 'recalled'
      ? transferredStatus
      : restoredOnHand <= QUANTITY_EPSILON
        ? 'depleted'
        : 'active'
    : row.destinationPreviousStatus === 'quarantined' ||
        row.destinationPreviousStatus === 'expired' ||
        row.destinationPreviousStatus === 'recalled'
      ? row.destinationPreviousStatus
      : row.destinationLotWasCreated &&
          (transferredStatus === 'quarantined' ||
            transferredStatus === 'expired' ||
            transferredStatus === 'recalled')
        ? transferredStatus
        : isLotExpiredAt(lot.expiresAt, input.now, input.businessDate)
          ? 'expired'
          : restoredOnHand <= QUANTITY_EPSILON
            ? 'depleted'
            : 'active';
  const nextSyncVersion = (lot.syncVersion ?? 0) + 1;
  const changed = tx
    .update(inventoryLots)
    .set({
      onHand: restoredOnHand,
      unitCost: restoredUnitCost,
      status: restoredStatus,
      syncStatus: 'pending',
      syncVersion: nextSyncVersion,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(inventoryLots.id, row.destinationLotId),
        eq(inventoryLots.tenantId, input.tenantId),
        eq(inventoryLots.onHand, lot.onHand),
        eq(inventoryLots.unitCost, lot.unitCost),
        eq(inventoryLots.status, lot.status),
        lot.syncVersion === null
          ? isNull(inventoryLots.syncVersion)
          : eq(inventoryLots.syncVersion, lot.syncVersion),
        lot.expiresAt === null
          ? isNull(inventoryLots.expiresAt)
          : eq(inventoryLots.expiresAt, lot.expiresAt)
      )
    )
    .run();
  if (changed.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'LOT_STALE_STOCK',
      message: 'Destination lot changed while the transfer was being reversed',
      details: { lotId: row.destinationLotId },
    });
  }
  return transferredStatus;
}
