/** Blind physical-count lifecycle with transactional approval. */

import { roundQuantity } from '@puntovivo/shared/unit-math';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  initialInventory,
  inventoryBalances,
  inventoryCountLines,
  inventoryCountSessions,
  inventoryMovements,
  products,
  sites,
  unitXProduct,
  units,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { applyInventoryBalanceDelta } from '../../services/inventory-balances.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type {
  ApproveInventoryCountInput,
  CreateInventoryCountInput,
  RejectInventoryCountInput,
  SaveInventoryCountInput,
  SubmitInventoryCountInput,
} from '../../trpc/schemas/inventory.js';
import type { TransactionalInventoryContext } from './types.js';

function throwCountStatus(status: string, expected: string): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'INVENTORY_COUNT_INVALID_STATUS',
    message: `Inventory count is ${status}; expected ${expected}`,
    details: { status, expected },
  });
}

function throwCountVersion(entity: 'session' | 'line', id: string): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'INVENTORY_COUNT_STALE_VERSION',
    message: 'Inventory count changed after it was loaded',
    details: { entity, id },
  });
}

function quantityDifference(left: number, right: number): number {
  const difference = left - right;
  return Object.is(difference, -0) ? 0 : difference;
}

function getSessionRow(db: DatabaseInstance, tenantId: string, id: string) {
  const session = db
    .select({
      id: inventoryCountSessions.id,
      tenantId: inventoryCountSessions.tenantId,
      siteId: inventoryCountSessions.siteId,
      siteName: sites.name,
      status: inventoryCountSessions.status,
      isBlind: inventoryCountSessions.isBlind,
      notes: inventoryCountSessions.notes,
      rejectionReason: inventoryCountSessions.rejectionReason,
      createdBy: inventoryCountSessions.createdBy,
      submittedBy: inventoryCountSessions.submittedBy,
      approvedBy: inventoryCountSessions.approvedBy,
      rejectedBy: inventoryCountSessions.rejectedBy,
      submittedAt: inventoryCountSessions.submittedAt,
      approvedAt: inventoryCountSessions.approvedAt,
      rejectedAt: inventoryCountSessions.rejectedAt,
      version: inventoryCountSessions.version,
      syncStatus: inventoryCountSessions.syncStatus,
      syncVersion: inventoryCountSessions.syncVersion,
      createdAt: inventoryCountSessions.createdAt,
      updatedAt: inventoryCountSessions.updatedAt,
    })
    .from(inventoryCountSessions)
    .innerJoin(
      sites,
      and(eq(inventoryCountSessions.siteId, sites.id), eq(sites.tenantId, tenantId))
    )
    .where(and(eq(inventoryCountSessions.id, id), eq(inventoryCountSessions.tenantId, tenantId)))
    .get();

  if (!session) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory count not found' });
  }

  return session;
}

export function getInventoryCountRecord(db: DatabaseInstance, tenantId: string, id: string) {
  const session = getSessionRow(db, tenantId, id);
  const revealExpected = session.status !== 'counting';
  const lines = db
    .select({
      id: inventoryCountLines.id,
      tenantId: inventoryCountLines.tenantId,
      sessionId: inventoryCountLines.sessionId,
      productId: inventoryCountLines.productId,
      productName: products.name,
      productSku: products.sku,
      unitId: inventoryCountLines.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      expectedQuantity: inventoryCountLines.expectedQuantity,
      countedQuantity: inventoryCountLines.countedQuantity,
      discrepancy: inventoryCountLines.discrepancy,
      unitCostSnapshot: inventoryCountLines.unitCostSnapshot,
      countedBy: inventoryCountLines.countedBy,
      countedAt: inventoryCountLines.countedAt,
      version: inventoryCountLines.version,
      createdAt: inventoryCountLines.createdAt,
      updatedAt: inventoryCountLines.updatedAt,
    })
    .from(inventoryCountLines)
    .innerJoin(
      products,
      and(eq(inventoryCountLines.productId, products.id), eq(products.tenantId, tenantId))
    )
    .innerJoin(units, and(eq(inventoryCountLines.unitId, units.id), eq(units.tenantId, tenantId)))
    .where(and(eq(inventoryCountLines.tenantId, tenantId), eq(inventoryCountLines.sessionId, id)))
    .orderBy(products.name)
    .all();

  const countedLineCount = lines.filter(line => line.countedQuantity !== null).length;
  const discrepancyLineCount = revealExpected
    ? lines.filter(line => (line.discrepancy ?? 0) !== 0).length
    : null;

  return {
    ...session,
    lineCount: lines.length,
    countedLineCount,
    discrepancyLineCount,
    lines: lines.map(line => ({
      ...line,
      expectedQuantity: revealExpected ? line.expectedQuantity : null,
      discrepancy: revealExpected ? line.discrepancy : null,
      unitCostSnapshot: revealExpected ? line.unitCostSnapshot : null,
    })),
  };
}

export function createInventoryCount(
  ctx: TransactionalInventoryContext,
  input: CreateInventoryCountInput
) {
  const now = new Date().toISOString();
  const sessionId = nanoid();

  return ctx.db.transaction(
    tx => {
      const site = tx
        .select({ id: sites.id, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, ctx.tenantId)))
        .get();
      if (!site || site.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected inventory site was not found or is inactive',
        });
      }

      const productRows = tx
        .select({
          id: products.id,
          name: products.name,
          isActive: products.isActive,
          tracksStock: products.tracksStock,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
          initialCost: products.initialCost,
          unitId: unitXProduct.unitId,
          unitIsActive: units.isActive,
          onHand: inventoryBalances.onHand,
          balanceVersion: inventoryBalances.version,
        })
        .from(products)
        .innerJoin(
          unitXProduct,
          and(eq(unitXProduct.productId, products.id), eq(unitXProduct.isBase, true))
        )
        .innerJoin(units, and(eq(unitXProduct.unitId, units.id), eq(units.tenantId, ctx.tenantId)))
        .leftJoin(
          inventoryBalances,
          and(
            eq(inventoryBalances.tenantId, ctx.tenantId),
            eq(inventoryBalances.siteId, input.siteId),
            eq(inventoryBalances.productId, products.id)
          )
        )
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, input.productIds)))
        .all();

      const rowByProduct = new Map(productRows.map(row => [row.id, row]));
      if (
        rowByProduct.size !== input.productIds.length ||
        productRows.length !== input.productIds.length
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Every counted product must have exactly one active base unit',
        });
      }

      for (const productId of input.productIds) {
        const product = rowByProduct.get(productId)!;
        if (
          product.isActive === false ||
          product.tracksStock === false ||
          product.unitIsActive === false
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Product ${product.name} is not active stock`,
          });
        }
        if (
          product.tracksLots ||
          product.tracksSerials ||
          product.catalogType === 'variant_parent'
        ) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'INVENTORY_COUNT_IDENTITY_TRACKING_REQUIRED',
            message: 'Blind aggregate counts cannot change lot, serial, or matrix identity',
            details: { productId, productName: product.name },
          });
        }
      }

      const existingOpenLines = tx
        .select({ productId: inventoryCountLines.productId })
        .from(inventoryCountLines)
        .innerJoin(
          inventoryCountSessions,
          and(
            eq(inventoryCountLines.sessionId, inventoryCountSessions.id),
            eq(inventoryCountSessions.tenantId, ctx.tenantId)
          )
        )
        .where(
          and(
            eq(inventoryCountLines.tenantId, ctx.tenantId),
            eq(inventoryCountSessions.siteId, input.siteId),
            inArray(inventoryCountSessions.status, ['counting', 'submitted']),
            inArray(inventoryCountLines.productId, input.productIds)
          )
        )
        .all();
      if (existingOpenLines.length > 0) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'INVENTORY_COUNT_ALREADY_OPEN',
          message: 'A product already belongs to an unfinished count at this site',
          details: { productIds: existingOpenLines.map(line => line.productId) },
        });
      }

      tx.insert(inventoryCountSessions)
        .values({
          id: sessionId,
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          status: 'counting',
          isBlind: true,
          notes: input.notes,
          createdBy: ctx.user.id,
          version: 0,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const syncContext = { ...ctx, db: tx as unknown as DatabaseInstance };
      for (const productId of input.productIds) {
        const product = rowByProduct.get(productId)!;
        const lineId = nanoid();
        // Keep the exact signed book value. Counted input is normalized to the
        // supported 0.001 precision, but rounding the opening balance would
        // leave a residual when approval applies the delta to historical rows
        // that carry finer precision.
        const expectedQuantity = product.onHand ?? 0;
        tx.insert(inventoryCountLines)
          .values({
            id: lineId,
            tenantId: ctx.tenantId,
            sessionId,
            productId,
            unitId: product.unitId,
            expectedQuantity,
            expectedBalanceVersion: product.balanceVersion ?? 0,
            countedQuantity: null,
            discrepancy: null,
            unitCostSnapshot: product.initialCost,
            version: 0,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        enqueueSyncInTransaction(syncContext, {
          entityType: 'inventory_count_lines',
          entityId: lineId,
          operation: 'create',
          data: {
            id: lineId,
            tenantId: ctx.tenantId,
            sessionId,
            productId,
            unitId: product.unitId,
            expectedQuantity,
            expectedBalanceVersion: product.balanceVersion ?? 0,
            version: 0,
          },
        });
      }

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.count.create',
        resourceType: 'inventory_count_session',
        resourceId: sessionId,
        before: null,
        after: { status: 'counting', isBlind: true },
        metadata: { siteId: input.siteId, lineCount: input.productIds.length },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(syncContext, {
        entityType: 'inventory_count_sessions',
        entityId: sessionId,
        operation: 'create',
        data: {
          id: sessionId,
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          status: 'counting',
          isBlind: true,
          version: 0,
        },
      });

      const result = getInventoryCountRecord(
        tx as unknown as DatabaseInstance,
        ctx.tenantId,
        sessionId
      );
      ctx.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function saveInventoryCount(
  ctx: TransactionalInventoryContext,
  input: SaveInventoryCountInput
) {
  const now = new Date().toISOString();

  return ctx.db.transaction(
    tx => {
      const session = getSessionRow(tx as unknown as DatabaseInstance, ctx.tenantId, input.id);
      if (session.status !== 'counting') throwCountStatus(session.status, 'counting');
      if (session.version !== input.version) throwCountVersion('session', session.id);

      const requestedIds = input.lines.map(line => line.lineId);
      const storedLines = tx
        .select({
          id: inventoryCountLines.id,
          version: inventoryCountLines.version,
          syncVersion: inventoryCountLines.syncVersion,
          countedQuantity: inventoryCountLines.countedQuantity,
        })
        .from(inventoryCountLines)
        .where(
          and(
            eq(inventoryCountLines.tenantId, ctx.tenantId),
            eq(inventoryCountLines.sessionId, input.id),
            inArray(inventoryCountLines.id, requestedIds)
          )
        )
        .all();
      if (storedLines.length !== input.lines.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory count line not found' });
      }
      const storedById = new Map(storedLines.map(line => [line.id, line]));
      const syncContext = { ...ctx, db: tx as unknown as DatabaseInstance };

      for (const line of input.lines) {
        const stored = storedById.get(line.lineId)!;
        if (stored.version !== line.version) throwCountVersion('line', line.lineId);
        const countedQuantity = roundQuantity(line.countedQuantity);
        const updated = tx
          .update(inventoryCountLines)
          .set({
            countedQuantity,
            countedBy: ctx.user.id,
            countedAt: now,
            version: stored.version + 1,
            syncStatus: 'pending',
            syncVersion: (stored.syncVersion ?? 0) + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryCountLines.id, line.lineId),
              eq(inventoryCountLines.tenantId, ctx.tenantId),
              eq(inventoryCountLines.sessionId, input.id),
              eq(inventoryCountLines.version, line.version)
            )
          )
          .run();
        if (updated.changes !== 1) throwCountVersion('line', line.lineId);
        enqueueSyncInTransaction(syncContext, {
          entityType: 'inventory_count_lines',
          entityId: line.lineId,
          operation: 'update',
          data: {
            id: line.lineId,
            sessionId: input.id,
            countedQuantity,
            countedBy: ctx.user.id,
            countedAt: now,
            version: stored.version + 1,
          },
        });
      }

      const sessionUpdate = tx
        .update(inventoryCountSessions)
        .set({
          version: session.version + 1,
          syncStatus: 'pending',
          syncVersion: (session.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryCountSessions.id, input.id),
            eq(inventoryCountSessions.tenantId, ctx.tenantId),
            eq(inventoryCountSessions.status, 'counting'),
            eq(inventoryCountSessions.version, input.version)
          )
        )
        .run();
      if (sessionUpdate.changes !== 1) throwCountVersion('session', input.id);

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.count.save',
        resourceType: 'inventory_count_session',
        resourceId: input.id,
        before: { version: session.version },
        after: { version: session.version + 1 },
        metadata: { siteId: session.siteId, savedLineCount: input.lines.length },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(syncContext, {
        entityType: 'inventory_count_sessions',
        entityId: input.id,
        operation: 'update',
        data: { id: input.id, status: 'counting', version: session.version + 1 },
      });

      const result = getInventoryCountRecord(
        tx as unknown as DatabaseInstance,
        ctx.tenantId,
        input.id
      );
      ctx.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function submitInventoryCount(
  ctx: TransactionalInventoryContext,
  input: SubmitInventoryCountInput
) {
  const now = new Date().toISOString();

  return ctx.db.transaction(
    tx => {
      const session = getSessionRow(tx as unknown as DatabaseInstance, ctx.tenantId, input.id);
      if (session.status !== 'counting') throwCountStatus(session.status, 'counting');
      if (session.version !== input.version) throwCountVersion('session', session.id);

      const lines = tx
        .select()
        .from(inventoryCountLines)
        .where(
          and(
            eq(inventoryCountLines.tenantId, ctx.tenantId),
            eq(inventoryCountLines.sessionId, input.id)
          )
        )
        .all();
      if (lines.length === 0 || lines.some(line => line.countedQuantity === null)) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'INVENTORY_COUNT_INCOMPLETE',
          message: 'Every count line needs a quantity before submission',
          details: {
            lineCount: lines.length,
            countedLineCount: lines.filter(line => line.countedQuantity !== null).length,
          },
        });
      }

      const syncContext = { ...ctx, db: tx as unknown as DatabaseInstance };
      let discrepancyLineCount = 0;
      let absoluteVariance = 0;
      for (const line of lines) {
        const discrepancy = quantityDifference(line.countedQuantity!, line.expectedQuantity);
        if (discrepancy !== 0) discrepancyLineCount += 1;
        absoluteVariance += Math.abs(discrepancy);
        const lineUpdate = tx
          .update(inventoryCountLines)
          .set({
            discrepancy,
            version: line.version + 1,
            syncStatus: 'pending',
            syncVersion: (line.syncVersion ?? 0) + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryCountLines.id, line.id),
              eq(inventoryCountLines.tenantId, ctx.tenantId),
              eq(inventoryCountLines.version, line.version)
            )
          )
          .run();
        if (lineUpdate.changes !== 1) throwCountVersion('line', line.id);
        enqueueSyncInTransaction(syncContext, {
          entityType: 'inventory_count_lines',
          entityId: line.id,
          operation: 'update',
          data: {
            id: line.id,
            sessionId: input.id,
            countedQuantity: line.countedQuantity,
            discrepancy,
            version: line.version + 1,
          },
        });
      }

      const updated = tx
        .update(inventoryCountSessions)
        .set({
          status: 'submitted',
          submittedBy: ctx.user.id,
          submittedAt: now,
          version: session.version + 1,
          syncStatus: 'pending',
          syncVersion: (session.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryCountSessions.id, input.id),
            eq(inventoryCountSessions.tenantId, ctx.tenantId),
            eq(inventoryCountSessions.status, 'counting'),
            eq(inventoryCountSessions.version, input.version)
          )
        )
        .run();
      if (updated.changes !== 1) throwCountVersion('session', input.id);

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.count.submit',
        resourceType: 'inventory_count_session',
        resourceId: input.id,
        before: { status: 'counting' },
        after: { status: 'submitted' },
        metadata: { siteId: session.siteId, discrepancyLineCount, absoluteVariance },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(syncContext, {
        entityType: 'inventory_count_sessions',
        entityId: input.id,
        operation: 'update',
        data: {
          id: input.id,
          status: 'submitted',
          submittedBy: ctx.user.id,
          submittedAt: now,
          version: session.version + 1,
        },
      });

      const result = getInventoryCountRecord(
        tx as unknown as DatabaseInstance,
        ctx.tenantId,
        input.id
      );
      ctx.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function approveInventoryCount(
  ctx: TransactionalInventoryContext,
  input: ApproveInventoryCountInput
) {
  const now = new Date().toISOString();

  return ctx.db.transaction(
    tx => {
      const session = getSessionRow(tx as unknown as DatabaseInstance, ctx.tenantId, input.id);
      if (session.status !== 'submitted') throwCountStatus(session.status, 'submitted');
      if (session.version !== input.version) throwCountVersion('session', session.id);

      const lines = tx
        .select({
          id: inventoryCountLines.id,
          productId: inventoryCountLines.productId,
          unitId: inventoryCountLines.unitId,
          expectedQuantity: inventoryCountLines.expectedQuantity,
          expectedBalanceVersion: inventoryCountLines.expectedBalanceVersion,
          countedQuantity: inventoryCountLines.countedQuantity,
          discrepancy: inventoryCountLines.discrepancy,
          unitCostSnapshot: inventoryCountLines.unitCostSnapshot,
          productName: products.name,
          productIsActive: products.isActive,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
          catalogType: products.catalogType,
          tracksStock: products.tracksStock,
        })
        .from(inventoryCountLines)
        .innerJoin(
          products,
          and(eq(inventoryCountLines.productId, products.id), eq(products.tenantId, ctx.tenantId))
        )
        .where(
          and(
            eq(inventoryCountLines.tenantId, ctx.tenantId),
            eq(inventoryCountLines.sessionId, input.id)
          )
        )
        .all();
      if (lines.length === 0 || lines.some(line => line.countedQuantity === null)) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'INVENTORY_COUNT_INCOMPLETE',
          message: 'Submitted count is missing a counted quantity',
        });
      }

      const productIds = lines.map(line => line.productId);
      const balanceRows = tx
        .select({
          productId: inventoryBalances.productId,
          onHand: inventoryBalances.onHand,
          version: inventoryBalances.version,
        })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, ctx.tenantId),
            eq(inventoryBalances.siteId, session.siteId),
            inArray(inventoryBalances.productId, productIds)
          )
        )
        .all();
      const balanceByProduct = new Map(
        balanceRows.map(row => [row.productId, { onHand: row.onHand, version: row.version ?? 0 }])
      );

      const baseUnitRows = tx
        .select({
          productId: unitXProduct.productId,
          unitId: unitXProduct.unitId,
          equivalence: unitXProduct.equivalence,
          unitIsActive: units.isActive,
        })
        .from(unitXProduct)
        .innerJoin(units, and(eq(unitXProduct.unitId, units.id), eq(units.tenantId, ctx.tenantId)))
        .where(and(inArray(unitXProduct.productId, productIds), eq(unitXProduct.isBase, true)))
        .all();
      const baseUnitByProduct = new Map<
        string,
        { unitId: string; equivalence: number; unitIsActive: boolean | null }
      >();
      const ambiguousBaseUnits = new Set<string>();
      for (const row of baseUnitRows) {
        if (baseUnitByProduct.has(row.productId)) ambiguousBaseUnits.add(row.productId);
        else baseUnitByProduct.set(row.productId, row);
      }

      for (const line of lines) {
        if (
          line.tracksLots ||
          line.tracksSerials ||
          line.catalogType === 'variant_parent' ||
          line.tracksStock === false
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'INVENTORY_COUNT_IDENTITY_TRACKING_REQUIRED',
            message: 'Product tracking policy changed after this count started',
            details: { productId: line.productId, productName: line.productName },
          });
        }
        const currentBaseUnit = baseUnitByProduct.get(line.productId);
        if (
          line.productIsActive === false ||
          !currentBaseUnit ||
          ambiguousBaseUnits.has(line.productId) ||
          currentBaseUnit.unitId !== line.unitId ||
          currentBaseUnit.equivalence !== 1 ||
          currentBaseUnit.unitIsActive === false
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'INVENTORY_COUNT_CATALOG_CHANGED',
            message: 'Product or base-unit policy changed after this count started',
            details: { productId: line.productId, productName: line.productName },
          });
        }
        const currentBalance = balanceByProduct.get(line.productId);
        const currentQuantity = currentBalance?.onHand ?? 0;
        const currentBalanceVersion = currentBalance?.version ?? 0;
        if (
          currentQuantity !== line.expectedQuantity ||
          currentBalanceVersion !== line.expectedBalanceVersion
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'INVENTORY_COUNT_BALANCE_CHANGED',
            message: 'Site stock changed after the count snapshot was created',
            details: {
              productId: line.productId,
              expectedQuantity: line.expectedQuantity,
              currentQuantity,
              expectedBalanceVersion: line.expectedBalanceVersion,
              currentBalanceVersion,
            },
          });
        }
      }

      const syncContext = { ...ctx, db: tx as unknown as DatabaseInstance };
      let adjustedLineCount = 0;
      let signedVariance = 0;
      for (const line of lines) {
        const countedQuantity = roundQuantity(line.countedQuantity!);
        const discrepancy = quantityDifference(countedQuantity, line.expectedQuantity);
        signedVariance += discrepancy;
        const entryId = nanoid();
        tx.insert(initialInventory)
          .values({
            id: entryId,
            tenantId: ctx.tenantId,
            productId: line.productId,
            unitId: line.unitId,
            siteId: session.siteId,
            mode: 'physical',
            quantity: countedQuantity,
            unitEquivalence: 1,
            normalizedQuantity: countedQuantity,
            cost: line.unitCostSnapshot,
            previousStock: line.expectedQuantity,
            newStock: countedQuantity,
            notes: session.notes,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        enqueueSyncInTransaction(syncContext, {
          entityType: 'initial_inventory',
          entityId: entryId,
          operation: 'create',
          data: {
            id: entryId,
            productId: line.productId,
            siteId: session.siteId,
            mode: 'physical',
            quantity: countedQuantity,
            previousStock: line.expectedQuantity,
            newStock: countedQuantity,
            countSessionId: input.id,
          },
        });

        if (discrepancy === 0) continue;
        adjustedLineCount += 1;
        applyInventoryBalanceDelta(tx as unknown as DatabaseInstance, {
          tenantId: ctx.tenantId,
          siteId: session.siteId,
          productId: line.productId,
          delta: discrepancy,
          initialOnHandIfMissing: line.expectedQuantity,
          now,
        });
        const movementId = nanoid();
        tx.insert(inventoryMovements)
          .values({
            id: movementId,
            tenantId: ctx.tenantId,
            productId: line.productId,
            siteId: session.siteId,
            type: 'adjustment',
            quantity: Math.abs(discrepancy),
            previousStock: line.expectedQuantity,
            newStock: countedQuantity,
            reference: `inventory-count:${input.id}`,
            notes: session.notes,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        enqueueSyncInTransaction(syncContext, {
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: {
            id: movementId,
            productId: line.productId,
            siteId: session.siteId,
            type: 'adjustment',
            quantity: Math.abs(discrepancy),
            previousStock: line.expectedQuantity,
            newStock: countedQuantity,
            countSessionId: input.id,
          },
        });
      }

      const updated = tx
        .update(inventoryCountSessions)
        .set({
          status: 'approved',
          approvedBy: ctx.user.id,
          approvedAt: now,
          version: session.version + 1,
          syncStatus: 'pending',
          syncVersion: (session.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryCountSessions.id, input.id),
            eq(inventoryCountSessions.tenantId, ctx.tenantId),
            eq(inventoryCountSessions.status, 'submitted'),
            eq(inventoryCountSessions.version, input.version)
          )
        )
        .run();
      if (updated.changes !== 1) throwCountVersion('session', input.id);

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.count.approve',
        resourceType: 'inventory_count_session',
        resourceId: input.id,
        before: { status: 'submitted' },
        after: { status: 'approved' },
        metadata: {
          siteId: session.siteId,
          lineCount: lines.length,
          adjustedLineCount,
          signedVariance,
        },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(syncContext, {
        entityType: 'inventory_count_sessions',
        entityId: input.id,
        operation: 'update',
        data: {
          id: input.id,
          status: 'approved',
          approvedBy: ctx.user.id,
          approvedAt: now,
          version: session.version + 1,
        },
      });

      const result = getInventoryCountRecord(
        tx as unknown as DatabaseInstance,
        ctx.tenantId,
        input.id
      );
      ctx.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function rejectInventoryCount(
  ctx: TransactionalInventoryContext,
  input: RejectInventoryCountInput
) {
  const now = new Date().toISOString();

  return ctx.db.transaction(
    tx => {
      const session = getSessionRow(tx as unknown as DatabaseInstance, ctx.tenantId, input.id);
      if (session.status !== 'submitted') throwCountStatus(session.status, 'submitted');
      if (session.version !== input.version) throwCountVersion('session', session.id);

      const updated = tx
        .update(inventoryCountSessions)
        .set({
          status: 'rejected',
          rejectionReason: input.reason,
          rejectedBy: ctx.user.id,
          rejectedAt: now,
          version: session.version + 1,
          syncStatus: 'pending',
          syncVersion: (session.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryCountSessions.id, input.id),
            eq(inventoryCountSessions.tenantId, ctx.tenantId),
            eq(inventoryCountSessions.status, 'submitted'),
            eq(inventoryCountSessions.version, input.version)
          )
        )
        .run();
      if (updated.changes !== 1) throwCountVersion('session', input.id);

      const syncContext = { ...ctx, db: tx as unknown as DatabaseInstance };
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'inventory.count.reject',
        resourceType: 'inventory_count_session',
        resourceId: input.id,
        before: { status: 'submitted' },
        after: { status: 'rejected' },
        metadata: { siteId: session.siteId, reason: input.reason },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(syncContext, {
        entityType: 'inventory_count_sessions',
        entityId: input.id,
        operation: 'update',
        data: {
          id: input.id,
          status: 'rejected',
          rejectionReason: input.reason,
          rejectedBy: ctx.user.id,
          rejectedAt: now,
          version: session.version + 1,
        },
      });

      const result = getInventoryCountRecord(
        tx as unknown as DatabaseInstance,
        ctx.tenantId,
        input.id
      );
      ctx.completeInTransaction(tx as unknown as DatabaseInstance, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
