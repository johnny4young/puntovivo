/**
 * Transactional restaurant-service lifecycle.
 *
 * These helpers deliberately accept an already reserved SQLite writer. A
 * restaurant check is not a second sale system: it is operational metadata
 * around the authoritative `sales` aggregate and must commit or roll back with
 * that sale. Read-only projections live in the router; all state transitions
 * are centralized here so Touch, Mobile Waiter and the traditional POS share
 * the same invariants.
 *
 * @module application/restaurant/service-lifecycle
 */
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  restaurantCheckLines,
  restaurantChecks,
  restaurantCourses,
  restaurantDiners,
  restaurantLineModifiers,
  restaurantRounds,
  restaurantServices,
  restaurantTables,
  saleItems,
  sales,
  tenants,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { isModuleActiveInSettings } from '../../services/modules/manifest.js';

/** Structured modifier frozen against one restaurant line. */
export interface RestaurantLineModifierInput {
  name: string;
  quantity: number;
  unitPriceDelta: number;
}

/** Restaurant metadata parallel to one sale item by zero-based input index. */
export interface RestaurantOrderLineInput {
  itemIndex: number;
  dinerClientId?: string | null | undefined;
  courseKey: 'starter' | 'main' | 'dessert' | 'drink' | 'other';
  modifiers: RestaurantLineModifierInput[];
}

/** Client-local diner identity resolved to a server id inside the sale tx. */
export interface RestaurantDinerInput {
  clientId: string;
  label?: string | null | undefined;
  seatNumber?: number | null | undefined;
}

/** Metadata required to atomically open one restaurant check. */
export interface OpenRestaurantCheckInput {
  tableId: string;
  guestCount: number;
  checkLabel?: string | null | undefined;
  roundLabel?: string | null | undefined;
  diners: RestaurantDinerInput[];
  lines: RestaurantOrderLineInput[];
}

/** Actor and tenancy facts frozen by the caller for one restaurant write transaction. */
interface RestaurantTxContext {
  tenantId: string;
  siteId: string;
  actorId: string;
  now: string;
}

/** Synchronous Drizzle handle used by both the root database and nested write transactions. */
type RestaurantTransaction = DatabaseInstance;

/** Shared writer/read projection ceilings for one open table service. */
export const RESTAURANT_SERVICE_LIMITS = {
  openChecks: 100,
  activeDiners: 200,
  openLines: 1_000,
  openRounds: 1_000,
  openModifiers: 4_000,
} as const;
const RESTAURANT_COURSE_KEYS = ['starter', 'main', 'dessert', 'drink', 'other'] as const;

function assertOpenRestaurantInput(input: OpenRestaurantCheckInput, saleItemCount: number): void {
  const invalidLines =
    input.lines.length === 0 ||
    input.lines.length > 200 ||
    input.lines.length !== saleItemCount ||
    input.lines.some((line, position) => line.itemIndex !== position);
  const dinerIds = input.diners.map(diner => diner.clientId);
  const dinerSeats = input.diners
    .map(diner => diner.seatNumber)
    .filter((seat): seat is number => seat != null);
  const knownDiners = new Set(dinerIds);
  const invalidDiners =
    input.diners.length > 200 ||
    input.diners.length > input.guestCount ||
    new Set(dinerIds).size !== dinerIds.length ||
    new Set(dinerSeats).size !== dinerSeats.length ||
    dinerSeats.some(seat => !Number.isInteger(seat) || seat < 1 || seat > input.guestCount) ||
    input.diners.some(
      diner =>
        diner.clientId.trim().length === 0 ||
        diner.clientId.length > 80 ||
        (diner.label != null && (diner.label.trim().length === 0 || diner.label.trim().length > 80))
    );
  const invalidMetadata =
    !Number.isInteger(input.guestCount) ||
    input.guestCount < 1 ||
    input.guestCount > 200 ||
    (input.checkLabel != null && input.checkLabel.trim().length > 80) ||
    (input.roundLabel != null && input.roundLabel.trim().length > 80);
  const invalidLineMetadata = input.lines.some(line => {
    const names = line.modifiers.map(modifier => modifier.name.trim().toLowerCase());
    return (
      !RESTAURANT_COURSE_KEYS.includes(line.courseKey) ||
      (line.dinerClientId != null && !knownDiners.has(line.dinerClientId)) ||
      line.modifiers.length > 20 ||
      new Set(names).size !== names.length ||
      line.modifiers.some(
        modifier =>
          modifier.name.trim().length === 0 ||
          modifier.name.trim().length > 80 ||
          !Number.isInteger(modifier.quantity) ||
          modifier.quantity < 1 ||
          modifier.quantity > 20 ||
          !Number.isFinite(modifier.unitPriceDelta) ||
          modifier.unitPriceDelta < 0 ||
          modifier.unitPriceDelta > 1_000_000_000
      )
    );
  });

  if (invalidLines || invalidDiners || invalidMetadata || invalidLineMetadata) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: invalidDiners
        ? 'RESTAURANT_SERVICE_DINER_INVALID'
        : 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'Restaurant service metadata is incomplete or invalid',
    });
  }
}

function assertCheckCapacity(tx: RestaurantTransaction, tenantId: string, serviceId: string): void {
  const row = tx
    .select({ value: count() })
    .from(restaurantChecks)
    .where(
      and(
        eq(restaurantChecks.tenantId, tenantId),
        eq(restaurantChecks.serviceId, serviceId),
        eq(restaurantChecks.status, 'open')
      )
    )
    .get();
  if ((row?.value ?? 0) >= RESTAURANT_SERVICE_LIMITS.openChecks) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
      message: 'The restaurant service reached the maximum number of open checks',
      details: { maximumOpenChecks: RESTAURANT_SERVICE_LIMITS.openChecks },
    });
  }
}

/**
 * Prove the normalized operational projection covers every frozen sale line
 * exactly once. The unique (tenant, sale_item) index prevents duplicates; the
 * joined count additionally rejects a check line that was repointed at a line
 * from another sale.
 */
function assertCheckLineCoverage(
  tx: RestaurantTransaction,
  tenantId: string,
  checkId: string,
  saleId: string
): void {
  const saleLineCount =
    tx.select({ value: count() }).from(saleItems).where(eq(saleItems.saleId, saleId)).get()
      ?.value ?? 0;
  const checkLineCount =
    tx
      .select({ value: count() })
      .from(restaurantCheckLines)
      .where(
        and(eq(restaurantCheckLines.tenantId, tenantId), eq(restaurantCheckLines.checkId, checkId))
      )
      .get()?.value ?? 0;
  const mappedLineCount =
    tx
      .select({ value: count() })
      .from(restaurantCheckLines)
      .innerJoin(
        saleItems,
        and(eq(saleItems.id, restaurantCheckLines.saleItemId), eq(saleItems.saleId, saleId))
      )
      .where(
        and(eq(restaurantCheckLines.tenantId, tenantId), eq(restaurantCheckLines.checkId, checkId))
      )
      .get()?.value ?? 0;
  if (
    saleLineCount === 0 ||
    checkLineCount !== saleLineCount ||
    mappedLineCount !== saleLineCount
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check metadata does not cover every frozen sale line',
      details: { saleLineCount, checkLineCount, mappedLineCount },
    });
  }
}

function assertServiceProjectionCapacity(
  tx: RestaurantTransaction,
  tenantId: string,
  serviceId: string,
  requestedLineCount: number,
  requestedModifierCount: number
): void {
  const currentLineCount =
    tx
      .select({ value: count() })
      .from(restaurantCheckLines)
      .innerJoin(
        restaurantChecks,
        and(
          eq(restaurantChecks.id, restaurantCheckLines.checkId),
          eq(restaurantChecks.tenantId, tenantId)
        )
      )
      .where(
        and(
          eq(restaurantCheckLines.tenantId, tenantId),
          eq(restaurantChecks.serviceId, serviceId),
          eq(restaurantChecks.status, 'open')
        )
      )
      .get()?.value ?? 0;
  const currentModifierCount =
    tx
      .select({ value: count() })
      .from(restaurantLineModifiers)
      .innerJoin(
        restaurantCheckLines,
        and(
          eq(restaurantCheckLines.id, restaurantLineModifiers.checkLineId),
          eq(restaurantCheckLines.tenantId, tenantId)
        )
      )
      .innerJoin(
        restaurantChecks,
        and(
          eq(restaurantChecks.id, restaurantCheckLines.checkId),
          eq(restaurantChecks.tenantId, tenantId)
        )
      )
      .where(
        and(
          eq(restaurantLineModifiers.tenantId, tenantId),
          eq(restaurantChecks.serviceId, serviceId),
          eq(restaurantChecks.status, 'open')
        )
      )
      .get()?.value ?? 0;
  if (
    currentLineCount + requestedLineCount > RESTAURANT_SERVICE_LIMITS.openLines ||
    currentModifierCount + requestedModifierCount > RESTAURANT_SERVICE_LIMITS.openModifiers
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
      message: 'Settle or split existing checks before adding more lines to this table service',
      details: {
        currentLineCount,
        requestedLineCount,
        maximumLineCount: RESTAURANT_SERVICE_LIMITS.openLines,
        currentModifierCount,
        requestedModifierCount,
        maximumModifierCount: RESTAURANT_SERVICE_LIMITS.openModifiers,
      },
    });
  }
}

function isDineInStillActive(tx: RestaurantTransaction, tenantId: string): boolean {
  const tenant = tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return Boolean(tenant && isModuleActiveInSettings(tenant.settings, 'dine-in'));
}

export function assertDineInStillActive(tx: RestaurantTransaction, tenantId: string): void {
  if (!isDineInStillActive(tx, tenantId)) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'MODULE_NOT_ACTIVATED',
      message: "Module 'dine-in' is not activated for this tenant",
      details: { moduleId: 'dine-in' },
    });
  }
}

function assertActiveTable(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  tableId: string
): { id: string; name: string; seatCount: number | null } {
  const table = tx
    .select({
      id: restaurantTables.id,
      name: restaurantTables.name,
      siteId: restaurantTables.siteId,
      seatCount: restaurantTables.seatCount,
      isActive: restaurantTables.isActive,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, tableId),
        eq(restaurantTables.tenantId, context.tenantId),
        eq(restaurantTables.siteId, context.siteId)
      )
    )
    .get();
  if (!table || table.isActive === false) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found at the active site',
      details: { tableId, siteId: context.siteId },
    });
  }
  return { id: table.id, name: table.name, seatCount: table.seatCount };
}

function findOpenService(
  tx: RestaurantTransaction,
  tenantId: string,
  tableId: string
): typeof restaurantServices.$inferSelect | undefined {
  return tx
    .select()
    .from(restaurantServices)
    .where(
      and(
        eq(restaurantServices.tenantId, tenantId),
        eq(restaurantServices.tableId, tableId),
        eq(restaurantServices.status, 'open')
      )
    )
    .get();
}

function createOpenService(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  tableId: string,
  guestCount: number | null
): typeof restaurantServices.$inferSelect {
  const id = nanoid();
  const row = {
    id,
    tenantId: context.tenantId,
    siteId: context.siteId,
    tableId,
    status: 'open' as const,
    guestCount,
    openedBy: context.actorId,
    openedAt: context.now,
    closedBy: null,
    closedAt: null,
    version: 1,
    createdAt: context.now,
    updatedAt: context.now,
  };
  tx.insert(restaurantServices).values(row).run();
  return row;
}

function resolveOrCreateOpenService(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  tableId: string,
  guestCount: number | null,
  enforceGuestCount: boolean
): typeof restaurantServices.$inferSelect {
  const existing = findOpenService(tx, context.tenantId, tableId);
  if (!existing) return createOpenService(tx, context, tableId, guestCount);
  if (existing.siteId !== context.siteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'The open restaurant service belongs to another site',
    });
  }
  if (enforceGuestCount && existing.guestCount !== null && existing.guestCount !== guestCount) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_GUEST_COUNT_CONFLICT',
      message: 'The table already has an open service with a different guest count',
      details: { expectedGuestCount: existing.guestCount, receivedGuestCount: guestCount },
    });
  }
  if (existing.guestCount === null && guestCount !== null) {
    const changed = tx
      .update(restaurantServices)
      .set({ guestCount, version: existing.version + 1, updatedAt: context.now })
      .where(
        and(
          eq(restaurantServices.id, existing.id),
          eq(restaurantServices.tenantId, context.tenantId),
          eq(restaurantServices.status, 'open'),
          eq(restaurantServices.version, existing.version)
        )
      )
      .run();
    if (changed.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
        message: 'Restaurant service changed while its guest count was being established',
      });
    }
    return { ...existing, guestCount, version: existing.version + 1, updatedAt: context.now };
  }
  return existing;
}

function requireOpenServiceForSite(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  serviceId: string
): typeof restaurantServices.$inferSelect {
  const service = tx
    .select()
    .from(restaurantServices)
    .where(
      and(eq(restaurantServices.id, serviceId), eq(restaurantServices.tenantId, context.tenantId))
    )
    .get();
  if (!service || service.status !== 'open' || service.siteId !== context.siteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check has no open service at its sale site',
    });
  }
  return service;
}

/** Reject table drafts that are not represented by the normalized service graph. */
export function assertNoUnnormalizedRestaurantDrafts(
  tx: RestaurantTransaction,
  tenantId: string,
  tableId: string,
  excludedSaleId?: string
): void {
  const row = tx
    .select({ id: sales.id })
    .from(sales)
    .leftJoin(
      restaurantChecks,
      and(eq(restaurantChecks.saleId, sales.id), eq(restaurantChecks.tenantId, tenantId))
    )
    .where(
      and(
        eq(sales.tenantId, tenantId),
        eq(sales.tableId, tableId),
        eq(sales.status, 'draft'),
        isNull(restaurantChecks.id),
        ...(excludedSaleId ? [ne(sales.id, excludedSaleId)] : [])
      )
    )
    .get();
  if (row) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'A table draft is not represented by the restaurant service graph',
      details: { tableId },
    });
  }
}

/**
 * Persist service/check/diner/course/round/line/modifier rows in the same
 * transaction that creates and reserves the draft sale.
 */
export function openRestaurantCheckInTransaction(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  args: {
    saleId: string;
    saleNumber: string;
    saleItemIds: readonly string[];
    input: OpenRestaurantCheckInput;
  }
): { serviceId: string; checkId: string; tableName: string } {
  assertOpenRestaurantInput(args.input, args.saleItemIds.length);
  const modifierSnapshots = tx
    .select({
      id: saleItems.id,
      restaurantModifierAmount: saleItems.restaurantModifierAmount,
    })
    .from(saleItems)
    .where(and(eq(saleItems.saleId, args.saleId), inArray(saleItems.id, [...args.saleItemIds])))
    .all();
  const modifierAmountBySaleItem = new Map(
    modifierSnapshots.map(item => [item.id, roundMoney(item.restaurantModifierAmount ?? 0)])
  );
  const hasModifierSnapshotMismatch =
    modifierSnapshots.length !== new Set(args.saleItemIds).size ||
    args.input.lines.some(line => {
      const saleItemId = args.saleItemIds[line.itemIndex];
      return (
        !saleItemId ||
        modifierAmountBySaleItem.get(saleItemId) !== restaurantModifierAmount(line.modifiers)
      );
    });
  if (hasModifierSnapshotMismatch) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Structured restaurant modifiers do not match the frozen sale amounts',
    });
  }
  assertDineInStillActive(tx, context.tenantId);
  const table = assertActiveTable(tx, context, args.input.tableId);
  if (table.seatCount !== null && args.input.guestCount > table.seatCount) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_CAPACITY_EXCEEDED',
      message: 'Guest count exceeds the configured table capacity',
      details: { guestCount: args.input.guestCount, seatCount: table.seatCount },
    });
  }
  assertNoUnnormalizedRestaurantDrafts(tx, context.tenantId, table.id, args.saleId);

  const service = resolveOrCreateOpenService(tx, context, table.id, args.input.guestCount, true);
  assertCheckCapacity(tx, context.tenantId, service.id);
  assertServiceProjectionCapacity(
    tx,
    context.tenantId,
    service.id,
    args.input.lines.length,
    args.input.lines.reduce((total, line) => total + line.modifiers.length, 0)
  );
  const checkId = nanoid();
  const label = args.input.checkLabel?.trim() || null;
  tx.insert(restaurantChecks)
    .values({
      id: checkId,
      tenantId: context.tenantId,
      serviceId: service.id,
      saleId: args.saleId,
      label,
      status: 'open',
      openedBy: context.actorId,
      openedAt: context.now,
      version: 1,
      createdAt: context.now,
      updatedAt: context.now,
    })
    .run();

  const requestedSeatNumbers = args.input.diners.flatMap(diner =>
    diner.seatNumber == null ? [] : [diner.seatNumber]
  );
  const existingSeatedDiners =
    requestedSeatNumbers.length === 0
      ? []
      : tx
          .select()
          .from(restaurantDiners)
          .where(
            and(
              eq(restaurantDiners.tenantId, context.tenantId),
              eq(restaurantDiners.serviceId, service.id),
              inArray(restaurantDiners.seatNumber, requestedSeatNumbers)
            )
          )
          .all();
  const existingDinerBySeat = new Map(
    existingSeatedDiners.flatMap(diner =>
      diner.seatNumber == null ? [] : ([[diner.seatNumber, diner]] as const)
    )
  );
  const activeDinerCount =
    tx
      .select({ value: count() })
      .from(restaurantDiners)
      .where(
        and(
          eq(restaurantDiners.tenantId, context.tenantId),
          eq(restaurantDiners.serviceId, service.id),
          eq(restaurantDiners.isActive, true)
        )
      )
      .get()?.value ?? 0;
  const dinersBecomingActive = args.input.diners.filter(diner => {
    const existing =
      diner.seatNumber == null ? undefined : existingDinerBySeat.get(diner.seatNumber);
    return !existing || !existing.isActive;
  }).length;
  if (activeDinerCount + dinersBecomingActive > args.input.guestCount) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
      message: 'Active diners cannot exceed the established guest count',
      details: {
        activeDinerCount,
        requestedAdditionalDiners: dinersBecomingActive,
        guestCount: args.input.guestCount,
      },
    });
  }

  const dinerIdByClientId = new Map<string, string>();
  for (const diner of args.input.diners) {
    const requestedLabel = diner.label?.trim() || null;
    const existingDiner =
      diner.seatNumber == null ? undefined : existingDinerBySeat.get(diner.seatNumber);
    if (existingDiner) {
      if (
        requestedLabel !== null &&
        existingDiner.label !== null &&
        existingDiner.label !== requestedLabel
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
          message: 'The requested seat belongs to a differently named diner',
          details: { seatNumber: diner.seatNumber },
        });
      }
      if (!existingDiner.isActive || (existingDiner.label === null && requestedLabel !== null)) {
        tx.update(restaurantDiners)
          .set({
            ...(existingDiner.label === null && requestedLabel !== null
              ? { label: requestedLabel }
              : {}),
            isActive: true,
            updatedAt: context.now,
          })
          .where(
            and(
              eq(restaurantDiners.id, existingDiner.id),
              eq(restaurantDiners.tenantId, context.tenantId),
              eq(restaurantDiners.serviceId, service.id)
            )
          )
          .run();
      }
      dinerIdByClientId.set(diner.clientId, existingDiner.id);
      continue;
    }
    const dinerId = nanoid();
    dinerIdByClientId.set(diner.clientId, dinerId);
    tx.insert(restaurantDiners)
      .values({
        id: dinerId,
        tenantId: context.tenantId,
        serviceId: service.id,
        label: requestedLabel,
        seatNumber: diner.seatNumber ?? null,
        isActive: true,
        createdAt: context.now,
        updatedAt: context.now,
      })
      .run();
  }

  const courseIdByKey = new Map<RestaurantOrderLineInput['courseKey'], string>();
  for (const courseKey of RESTAURANT_COURSE_KEYS) {
    if (!args.input.lines.some(line => line.courseKey === courseKey)) continue;
    const courseId = nanoid();
    courseIdByKey.set(courseKey, courseId);
    tx.insert(restaurantCourses)
      .values({
        id: courseId,
        tenantId: context.tenantId,
        checkId,
        courseKey,
        // The key is the durable language-neutral name. Renderers translate it.
        name: courseKey,
        position: RESTAURANT_COURSE_KEYS.indexOf(courseKey),
        createdAt: context.now,
      })
      .run();
  }

  const roundId = nanoid();
  tx.insert(restaurantRounds)
    .values({
      id: roundId,
      tenantId: context.tenantId,
      checkId,
      sequence: 1,
      label: args.input.roundLabel?.trim() || null,
      status: 'submitted',
      submittedBy: context.actorId,
      submittedAt: context.now,
      createdAt: context.now,
    })
    .run();

  for (const line of args.input.lines) {
    const saleItemId = args.saleItemIds[line.itemIndex];
    if (!saleItemId) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
        message: 'Restaurant line points outside the sale cart',
      });
    }
    const dinerId = line.dinerClientId ? (dinerIdByClientId.get(line.dinerClientId) ?? null) : null;
    if (line.dinerClientId && !dinerId) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RESTAURANT_SERVICE_DINER_INVALID',
        message: 'Restaurant line references an unknown diner',
      });
    }
    const checkLineId = nanoid();
    tx.insert(restaurantCheckLines)
      .values({
        id: checkLineId,
        tenantId: context.tenantId,
        checkId,
        saleItemId,
        roundId,
        courseId: courseIdByKey.get(line.courseKey) ?? null,
        dinerId,
        createdAt: context.now,
      })
      .run();
    for (const [position, modifier] of line.modifiers.entries()) {
      tx.insert(restaurantLineModifiers)
        .values({
          id: nanoid(),
          tenantId: context.tenantId,
          checkLineId,
          name: modifier.name.trim(),
          quantity: modifier.quantity,
          unitPriceDelta: roundMoney(modifier.unitPriceDelta),
          position,
          createdAt: context.now,
        })
        .run();
    }
  }

  writeAuditLog({
    tx,
    tenantId: context.tenantId,
    actorId: context.actorId,
    action: 'sale.park',
    resourceType: 'sale',
    resourceId: args.saleId,
    before: null,
    after: {
      status: 'draft',
      tableId: table.id,
      serviceId: service.id,
      checkId,
      guestCount: service.guestCount,
    },
    metadata: {
      atomicRestaurantOpen: true,
      saleNumber: args.saleNumber,
      tableName: table.name,
      lineCount: args.saleItemIds.length,
    },
  });

  return { serviceId: service.id, checkId, tableName: table.name };
}

/** Backfill-compatible normalization for a legacy create-then-suspend client. */
export function ensureRestaurantCheckForSuspendedSale(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  args: { saleId: string; tableId: string; label: string | null }
): void {
  const existingCheck = tx
    .select({ id: restaurantChecks.id })
    .from(restaurantChecks)
    .where(
      and(eq(restaurantChecks.tenantId, context.tenantId), eq(restaurantChecks.saleId, args.saleId))
    )
    .get();
  if (existingCheck) {
    // A resumed normalized check can be parked again at a different table.
    // Reconcile the operational graph before the caller updates sales.tableId;
    // merely returning here would leave the sale and check pointing at two
    // different tables.
    moveRestaurantCheckInTransaction(tx, context, {
      saleId: args.saleId,
      targetTableId: args.tableId,
    });
    return;
  }
  // Legacy clients still enter through generic sales routes, but compatibility
  // must never create hidden table work behind a disabled dine-in module.
  assertDineInStillActive(tx, context.tenantId);
  assertActiveTable(tx, context, args.tableId);
  const service = resolveOrCreateOpenService(tx, context, args.tableId, null, false);
  assertCheckCapacity(tx, context.tenantId, service.id);
  const itemRows = tx
    .select({ id: saleItems.id })
    .from(saleItems)
    .where(eq(saleItems.saleId, args.saleId))
    .all();
  // Legacy create-then-suspend clients enter through this compatibility path,
  // but they must not bypass the same bounded projection enforced by the
  // atomic restaurant command.
  assertServiceProjectionCapacity(tx, context.tenantId, service.id, itemRows.length, 0);
  const checkId = nanoid();
  tx.insert(restaurantChecks)
    .values({
      id: checkId,
      tenantId: context.tenantId,
      serviceId: service.id,
      saleId: args.saleId,
      label: args.label,
      status: 'open',
      openedBy: context.actorId,
      openedAt: context.now,
      version: 1,
      createdAt: context.now,
      updatedAt: context.now,
    })
    .run();
  for (const item of itemRows) {
    tx.insert(restaurantCheckLines)
      .values({
        id: nanoid(),
        tenantId: context.tenantId,
        checkId,
        saleItemId: item.id,
        createdAt: context.now,
      })
      .run();
  }
}

function closeServiceWhenEmpty(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  serviceId: string,
  excludedCheckId?: string
): void {
  const other = tx
    .select({ id: restaurantChecks.id })
    .from(restaurantChecks)
    .where(
      and(
        eq(restaurantChecks.tenantId, context.tenantId),
        eq(restaurantChecks.serviceId, serviceId),
        eq(restaurantChecks.status, 'open'),
        ...(excludedCheckId ? [ne(restaurantChecks.id, excludedCheckId)] : [])
      )
    )
    .get();
  if (other) return;
  const service = tx
    .select({ version: restaurantServices.version })
    .from(restaurantServices)
    .where(
      and(
        eq(restaurantServices.id, serviceId),
        eq(restaurantServices.tenantId, context.tenantId),
        eq(restaurantServices.status, 'open')
      )
    )
    .get();
  if (!service) return;
  const changed = tx
    .update(restaurantServices)
    .set({
      status: 'closed',
      closedBy: context.actorId,
      closedAt: context.now,
      version: service.version + 1,
      updatedAt: context.now,
    })
    .where(
      and(
        eq(restaurantServices.id, serviceId),
        eq(restaurantServices.tenantId, context.tenantId),
        eq(restaurantServices.status, 'open'),
        eq(restaurantServices.version, service.version)
      )
    )
    .run();
  if (changed.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant service changed while it was being closed',
    });
  }
}

/** Settle or cancel the normalized check for a sale, closing its service last. */
export function closeRestaurantCheckForSale(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  saleId: string,
  status: 'settled' | 'cancelled'
): void {
  const check = tx
    .select()
    .from(restaurantChecks)
    .where(
      and(eq(restaurantChecks.tenantId, context.tenantId), eq(restaurantChecks.saleId, saleId))
    )
    .get();
  if (!check) return;
  if (check.status !== 'open') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check is already closed while its sale remains a draft',
    });
  }
  const service = requireOpenServiceForSite(tx, context, check.serviceId);
  const sale = tx
    .select({ status: sales.status, tableId: sales.tableId })
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, context.tenantId)))
    .get();
  const expectedSaleStatus = status === 'settled' ? 'completed' : 'cancelled';
  if (!sale || sale.status !== expectedSaleStatus || sale.tableId !== service.tableId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check does not match the terminal sale and table state',
    });
  }
  if (status === 'settled') {
    assertCheckLineCoverage(tx, context.tenantId, check.id, saleId);
  }
  const changed = tx
    .update(restaurantChecks)
    .set({
      status,
      closedBy: context.actorId,
      closedAt: context.now,
      version: check.version + 1,
      updatedAt: context.now,
    })
    .where(
      and(
        eq(restaurantChecks.id, check.id),
        eq(restaurantChecks.tenantId, context.tenantId),
        eq(restaurantChecks.status, 'open'),
        eq(restaurantChecks.version, check.version)
      )
    )
    .run();
  if (changed.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check changed during its sale transition',
    });
  }
  closeServiceWhenEmpty(tx, context, check.serviceId, check.id);
}

/** Keep a normalized check and its service aligned with `sales.table_id`. */
export function moveRestaurantCheckInTransaction(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  args: { saleId: string; targetTableId: string | null }
): void {
  const check = tx
    .select()
    .from(restaurantChecks)
    .where(
      and(eq(restaurantChecks.tenantId, context.tenantId), eq(restaurantChecks.saleId, args.saleId))
    )
    .get();
  if (!check) return;
  if (check.status !== 'open') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Only an open restaurant check can move to another table',
    });
  }
  if (!args.targetTableId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_TABLE_REQUIRED',
      message: 'A normalized restaurant check cannot be detached from its physical table',
    });
  }
  const sourceService = requireOpenServiceForSite(tx, context, check.serviceId);
  const sourceSale = tx
    .select({ status: sales.status, suspendedAt: sales.suspendedAt, tableId: sales.tableId })
    .from(sales)
    .where(and(eq(sales.id, args.saleId), eq(sales.tenantId, context.tenantId)))
    .get();
  if (
    !sourceSale ||
    sourceSale.status !== 'draft' ||
    sourceSale.suspendedAt === null ||
    (sourceSale.tableId !== sourceService.tableId && sourceSale.tableId !== args.targetTableId)
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check does not match its suspended sale and physical table',
    });
  }
  assertActiveTable(tx, context, sourceService.tableId);
  if (sourceService.tableId === args.targetTableId) return;
  assertDineInStillActive(tx, context.tenantId);
  const targetTable = assertActiveTable(tx, context, args.targetTableId);
  if (
    sourceService.guestCount !== null &&
    targetTable.seatCount !== null &&
    sourceService.guestCount > targetTable.seatCount
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_CAPACITY_EXCEEDED',
      message: 'The current party does not fit at the target table',
      details: {
        guestCount: sourceService.guestCount,
        seatCount: targetTable.seatCount,
      },
    });
  }
  const sourceCheckCount =
    tx
      .select({ value: count() })
      .from(restaurantChecks)
      .where(
        and(
          eq(restaurantChecks.tenantId, context.tenantId),
          eq(restaurantChecks.serviceId, sourceService.id)
        )
      )
      .get()?.value ?? 0;
  const sourceHasAnotherDraft = tx
    .select({ id: sales.id })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, context.tenantId),
        eq(sales.tableId, sourceService.tableId),
        eq(sales.status, 'draft'),
        ne(sales.id, args.saleId)
      )
    )
    .get();
  const targetHasOpenService = tx
    .select({ id: restaurantServices.id })
    .from(restaurantServices)
    .where(
      and(
        eq(restaurantServices.tenantId, context.tenantId),
        eq(restaurantServices.tableId, args.targetTableId),
        eq(restaurantServices.status, 'open')
      )
    )
    .get();
  const targetHasDraft = tx
    .select({ id: sales.id })
    .from(sales)
    .where(
      and(
        eq(sales.tenantId, context.tenantId),
        eq(sales.tableId, args.targetTableId),
        eq(sales.status, 'draft'),
        ne(sales.id, args.saleId)
      )
    )
    .get();
  if (sourceCheckCount !== 1 || sourceHasAnotherDraft || targetHasOpenService || targetHasDraft) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      message: 'A shared restaurant party cannot be split or merged implicitly between tables',
      details: {
        sourceCheckCount,
        sourceHasAnotherDraft: Boolean(sourceHasAnotherDraft),
        targetOccupied: Boolean(targetHasOpenService || targetHasDraft),
      },
    });
  }

  // A sole check represents the whole visit. Move the service row itself so
  // its diner identities and line associations remain intact at the new table.
  const changed = tx
    .update(restaurantServices)
    .set({
      tableId: targetTable.id,
      version: sourceService.version + 1,
      updatedAt: context.now,
    })
    .where(
      and(
        eq(restaurantServices.id, sourceService.id),
        eq(restaurantServices.tenantId, context.tenantId),
        eq(restaurantServices.tableId, sourceService.tableId),
        eq(restaurantServices.status, 'open'),
        eq(restaurantServices.version, sourceService.version)
      )
    )
    .run();
  if (changed.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant service changed while it was moving tables',
    });
  }
}

/** Mirror an existing sale split into the normalized check model. */
export function splitRestaurantCheckInTransaction(
  tx: RestaurantTransaction,
  context: RestaurantTxContext,
  args: {
    sourceSaleId: string;
    newSaleId: string;
    movedSaleItemIds: readonly string[];
    targetTableId: string | null;
    label: string | null;
  }
): { tableId: string | null; label: string | null } {
  if (args.movedSaleItemIds.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'A restaurant check split must move at least one line',
    });
  }
  const sourceCheck = tx
    .select()
    .from(restaurantChecks)
    .where(
      and(
        eq(restaurantChecks.tenantId, context.tenantId),
        eq(restaurantChecks.saleId, args.sourceSaleId),
        eq(restaurantChecks.status, 'open')
      )
    )
    .get();
  if (!sourceCheck) return { tableId: args.targetTableId, label: args.label };
  assertDineInStillActive(tx, context.tenantId);
  const sourceService = requireOpenServiceForSite(tx, context, sourceCheck.serviceId);
  const sourceSale = tx
    .select({ status: sales.status, suspendedAt: sales.suspendedAt, tableId: sales.tableId })
    .from(sales)
    .where(and(eq(sales.id, args.sourceSaleId), eq(sales.tenantId, context.tenantId)))
    .get();
  if (
    !sourceSale ||
    sourceSale.status !== 'draft' ||
    sourceSale.suspendedAt === null ||
    sourceSale.tableId !== sourceService.tableId
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant check does not match its suspended source sale and table',
    });
  }
  // Legacy split callers used `null` to mean "same free-text context". For a
  // normalized check the only coherent interpretation is the current table;
  // silently detaching the sale would orphan the operational check.
  const effectiveTableId = args.targetTableId ?? sourceService.tableId;
  const targetTable = assertActiveTable(tx, context, effectiveTableId);
  if (sourceService.tableId !== effectiveTableId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_PARTY_REASSIGNMENT_REQUIRED',
      message: 'A split check must remain in its current table service',
      details: { sourceTableId: sourceService.tableId, targetTableId: effectiveTableId },
    });
  }
  const targetService = sourceService;
  assertCheckCapacity(tx, context.tenantId, targetService.id);

  const movedLines = tx
    .select({
      id: restaurantCheckLines.id,
      saleItemId: restaurantCheckLines.saleItemId,
      roundId: restaurantCheckLines.roundId,
      courseId: restaurantCheckLines.courseId,
      dinerId: restaurantCheckLines.dinerId,
    })
    .from(restaurantCheckLines)
    .where(
      and(
        eq(restaurantCheckLines.tenantId, context.tenantId),
        eq(restaurantCheckLines.checkId, sourceCheck.id),
        inArray(restaurantCheckLines.saleItemId, [...args.movedSaleItemIds])
      )
    )
    .all();
  if (
    movedLines.length !== new Set(args.movedSaleItemIds).size ||
    movedLines.some(line => !args.movedSaleItemIds.includes(line.saleItemId))
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'Restaurant check metadata does not cover every line selected for the split',
    });
  }
  const sourceLineCount =
    tx
      .select({ value: count() })
      .from(restaurantCheckLines)
      .where(
        and(
          eq(restaurantCheckLines.tenantId, context.tenantId),
          eq(restaurantCheckLines.checkId, sourceCheck.id)
        )
      )
      .get()?.value ?? 0;
  if (movedLines.length >= sourceLineCount) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
      message: 'A restaurant split must leave at least one line on the source check',
    });
  }

  const checkId = nanoid();
  const effectiveLabel = args.label ?? targetTable.name;
  tx.insert(restaurantChecks)
    .values({
      id: checkId,
      tenantId: context.tenantId,
      serviceId: targetService.id,
      saleId: args.newSaleId,
      label: effectiveLabel,
      status: 'open',
      openedBy: context.actorId,
      openedAt: context.now,
      version: 1,
      createdAt: context.now,
      updatedAt: context.now,
    })
    .run();

  const courseIdMap = new Map<string, string>();
  const sourceCourseIds = [
    ...new Set(movedLines.flatMap(line => (line.courseId ? [line.courseId] : []))),
  ];
  if (sourceCourseIds.length > 0) {
    const sourceCourses = tx
      .select()
      .from(restaurantCourses)
      .where(
        and(
          eq(restaurantCourses.tenantId, context.tenantId),
          eq(restaurantCourses.checkId, sourceCheck.id),
          inArray(restaurantCourses.id, sourceCourseIds)
        )
      )
      .all();
    if (sourceCourses.length !== sourceCourseIds.length) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
        message: 'Restaurant course metadata is incomplete during the split',
      });
    }
    for (const course of sourceCourses) {
      const clonedId = nanoid();
      courseIdMap.set(course.id, clonedId);
      tx.insert(restaurantCourses)
        .values({
          id: clonedId,
          tenantId: context.tenantId,
          checkId,
          courseKey: course.courseKey,
          name: course.name,
          position: course.position,
          createdAt: context.now,
        })
        .run();
    }
  }

  const roundIdMap = new Map<string, string>();
  const sourceRoundIds = [
    ...new Set(movedLines.flatMap(line => (line.roundId ? [line.roundId] : []))),
  ];
  if (sourceRoundIds.length > 0) {
    const sourceRounds = tx
      .select()
      .from(restaurantRounds)
      .where(
        and(
          eq(restaurantRounds.tenantId, context.tenantId),
          eq(restaurantRounds.checkId, sourceCheck.id),
          inArray(restaurantRounds.id, sourceRoundIds)
        )
      )
      .all();
    if (sourceRounds.length !== sourceRoundIds.length) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
        message: 'Restaurant round metadata is incomplete during the split',
      });
    }
    for (const round of sourceRounds) {
      const clonedId = nanoid();
      roundIdMap.set(round.id, clonedId);
      tx.insert(restaurantRounds)
        .values({
          id: clonedId,
          tenantId: context.tenantId,
          checkId,
          sequence: round.sequence,
          label: round.label,
          status: round.status,
          submittedBy: round.submittedBy,
          submittedAt: round.submittedAt,
          createdAt: context.now,
        })
        .run();
    }
  }

  for (const line of movedLines) {
    const moved = tx
      .update(restaurantCheckLines)
      .set({
        checkId,
        roundId: line.roundId ? (roundIdMap.get(line.roundId) ?? null) : null,
        courseId: line.courseId ? (courseIdMap.get(line.courseId) ?? null) : null,
        // A split creates another check inside the same table service. Keep
        // the diner assignment; cross-service party reassignment is rejected
        // above until there is an explicit seat-transfer workflow.
        dinerId: line.dinerId,
      })
      .where(
        and(
          eq(restaurantCheckLines.id, line.id),
          eq(restaurantCheckLines.tenantId, context.tenantId),
          eq(restaurantCheckLines.checkId, sourceCheck.id)
        )
      )
      .run();
    if (moved.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
        message: 'Restaurant line changed while its check was being split',
      });
    }
  }

  const updatedSale = tx
    .update(sales)
    .set({ tableId: effectiveTableId, suspendedLabel: effectiveLabel })
    .where(and(eq(sales.id, args.newSaleId), eq(sales.tenantId, context.tenantId)))
    .run();
  if (updatedSale.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'The split sale disappeared while restaurant metadata was being attached',
    });
  }
  return { tableId: effectiveTableId, label: effectiveLabel };
}

/** Sum per-unit structured modifier deltas with the shared money policy. */
export function restaurantModifierAmount(
  modifiers: readonly RestaurantLineModifierInput[]
): number {
  return modifiers.reduce(
    (sum, modifier) => roundMoney(sum + modifier.quantity * roundMoney(modifier.unitPriceDelta)),
    0
  );
}
