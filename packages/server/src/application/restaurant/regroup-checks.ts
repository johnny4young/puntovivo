/**
 * Regroup the open checks of one table service.
 *
 * Lines move between the service's suspended drafts, new drafts open for new
 * accounts and drafts left without lines are cancelled. Stock is never
 * touched: every line keeps the reservation its original draft made.
 *
 * @module application/restaurant/regroup-checks
 */
import { and, asc, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  kdsOrderLines,
  restaurantCheckLines,
  restaurantChecks,
  restaurantCourses,
  restaurantDiners,
  restaurantRounds,
  restaurantTables,
  saleItems,
  sales,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { allocateCentsByWeights, roundMoney, tryMoneyToSafeCents } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { assertSalesNotExternallyBound } from '../external-orders/sale-binding.js';
import { adoptLegacyKitchenSale } from '../kds/legacy.js';
import { reconcileKitchenSaleInTransaction } from '../kds/sale-lifecycle.js';
import {
  assertDraftHeaderMatchesLines,
  assertDraftSessionAtTableSite,
  assertDraftTenderDivisible,
  insertSuspendedChildDraft,
  invalidDraftSplit,
  readCashSessionSites,
  rebuildProvisionalDraftPayment,
  requireActiveSaleSequential,
  type DraftSplitTransaction,
} from '../sales/draft-split.js';
import {
  RESTAURANT_SERVICE_LIMITS,
  assertDineInStillActive,
  assertNoUnnormalizedRestaurantDrafts,
  cloneRestaurantCourse,
  cloneRestaurantRound,
  closeRestaurantCheckForSale,
  findOpenService,
} from './service-lifecycle.js';

/** Target layout requested for the table's accounts. */
export type RegroupChecksPlan =
  | { kind: 'byDiner' }
  | {
      kind: 'accounts';
      /** A null `checkId` opens a new check. */
      accounts: ReadonlyArray<{ checkId: string | null; saleItemIds: readonly string[] }>;
    };

/** An open check as the caller last read it. */
export interface RegroupCheckView {
  checkId: string;
  version: number;
}

/** Open checks of the table after the command, oldest first. */
export interface RegroupChecksResult {
  checks: Array<{
    checkId: string;
    saleId: string;
    saleNumber: string;
    total: number;
    saleItemIds: string[];
  }>;
  cancelledCheckIds: string[];
}

interface RegroupContext {
  tenantId: string;
  /** Site the caller is bound to; null for tenant-wide administrators. */
  callerSiteId: string | null | undefined;
  actorId: string;
  now: string;
  envelope?: { operationId: string; idempotencyKey?: string } | null | undefined;
  deviceId?: string | null | undefined;
}

type SaleRow = typeof sales.$inferSelect;
type RoundRow = typeof restaurantRounds.$inferSelect;
type CourseRow = typeof restaurantCourses.$inferSelect;

interface CheckState {
  id: string;
  openedAt: string;
  version: number;
  sale: SaleRow;
  /** Opened by this command. */
  created: boolean;
}

interface LineState {
  id: string;
  saleItemId: string;
  checkId: string;
  roundId: string | null;
  courseId: string | null;
  dinerId: string | null;
  total: number;
  taxAmount: number;
  grossCents: number;
  /** Check the line belonged to before the command, and its header shares in cents. */
  origin: CheckState;
  discountCents: number;
  tipCents: number;
  serviceCents: number;
}

interface Target {
  checkId: string | null;
  lines: LineState[];
}

function conflict(message: string, details?: Record<string, unknown>): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
    message,
    ...(details ? { details } : {}),
  });
}

function stale(message: string): never {
  throwServerError({ trpcCode: 'CONFLICT', errorCode: 'RESTAURANT_SPLIT_STALE', message });
}

function inUse(saleId: string): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'RESTAURANT_SPLIT_CHECK_IN_USE',
    message: 'A check of this table is resumed on a register',
    details: { saleId },
  });
}

function toCents(value: number): number {
  return (
    tryMoneyToSafeCents(value) ??
    invalidDraftSplit('A draft amount is outside the exact supported cent range')
  );
}

const fromCents = (cents: number): number => roundMoney(cents / 100);
const sumOf = <T>(rows: readonly T[], pick: (row: T) => number): number =>
  rows.reduce((sum, row) => sum + pick(row), 0);

function groupBy<K, T>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const group = grouped.get(key(row));
    if (group) group.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}

/** One group per diner by seat, shared plates last; each group reuses the check it overlaps most. */
function planByDiner(
  tx: DatabaseInstance,
  tenantId: string,
  serviceId: string,
  checks: readonly CheckState[],
  lines: readonly LineState[]
): Target[] {
  const seats = new Map(
    tx
      .select({ id: restaurantDiners.id, seatNumber: restaurantDiners.seatNumber })
      .from(restaurantDiners)
      .where(
        and(eq(restaurantDiners.tenantId, tenantId), eq(restaurantDiners.serviceId, serviceId))
      )
      .all()
      .map(diner => [diner.id, diner.seatNumber] as const)
  );
  const groups = [...groupBy(lines, line => line.dinerId).entries()]
    .sort(([a], [b]) => {
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
      const seatA = seats.get(a) ?? Number.MAX_SAFE_INTEGER;
      const seatB = seats.get(b) ?? Number.MAX_SAFE_INTEGER;
      return seatA - seatB || a.localeCompare(b);
    })
    .map(([, groupLines]) => groupLines);
  if (groups.length < 2) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SPLIT_SINGLE_DINER',
      message: 'Every line of this table belongs to the same diner',
    });
  }
  const pairs = groups.flatMap((groupLines, groupIndex) =>
    checks.map((check, checkIndex) => ({
      groupIndex,
      check,
      checkIndex,
      overlap: groupLines.filter(line => line.checkId === check.id).length,
    }))
  );
  // Zero-overlap pairs sort last, so a spare check is reused before a new one opens.
  pairs.sort(
    (a, b) => b.overlap - a.overlap || a.groupIndex - b.groupIndex || a.checkIndex - b.checkIndex
  );
  const checkByGroup = new Map<number, string>();
  const usedChecks = new Set<string>();
  for (const pair of pairs) {
    if (checkByGroup.has(pair.groupIndex) || usedChecks.has(pair.check.id)) continue;
    usedChecks.add(pair.check.id);
    checkByGroup.set(pair.groupIndex, pair.check.id);
  }
  return groups.map((groupLines, groupIndex) => ({
    checkId: checkByGroup.get(groupIndex) ?? null,
    lines: groupLines,
  }));
}

function planByAccounts(
  plan: Extract<RegroupChecksPlan, { kind: 'accounts' }>,
  checks: readonly CheckState[],
  lines: readonly LineState[]
): Target[] {
  const lineBySaleItem = new Map(lines.map(line => [line.saleItemId, line]));
  const knownChecks = new Set(checks.map(check => check.id));
  const seenChecks = new Set<string>();
  const seenItems = new Set<string>();
  const targets: Target[] = [];
  for (const account of plan.accounts) {
    if (account.checkId !== null) {
      if (!knownChecks.has(account.checkId) || seenChecks.has(account.checkId)) {
        stale('An account of the plan is no longer an open check of this table');
      }
      seenChecks.add(account.checkId);
    }
    const accountLines: LineState[] = [];
    for (const saleItemId of account.saleItemIds) {
      const line = lineBySaleItem.get(saleItemId);
      if (!line || seenItems.has(saleItemId)) {
        stale('The plan does not match the open lines of this table');
      }
      seenItems.add(saleItemId);
      accountLines.push(line);
    }
    if (accountLines.length > 0) targets.push({ checkId: account.checkId, lines: accountLines });
  }
  if (seenItems.size !== lines.length) {
    stale('The plan does not cover every open line of this table');
  }
  return targets;
}

/** Apply a regroup plan inside the caller's immediate transaction. */
export function regroupRestaurantChecksInTransaction(
  transaction: DraftSplitTransaction,
  context: RegroupContext,
  args: { tableId: string; checks: readonly RegroupCheckView[]; plan: RegroupChecksPlan }
): RegroupChecksResult {
  const tx = transaction as unknown as DatabaseInstance;
  const { tenantId, actorId, now } = context;
  assertDineInStillActive(tx, tenantId);
  const table = tx
    .select({
      id: restaurantTables.id,
      siteId: restaurantTables.siteId,
      name: restaurantTables.name,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, args.tableId),
        eq(restaurantTables.tenantId, tenantId),
        eq(restaurantTables.isActive, true),
        ...(context.callerSiteId ? [eq(restaurantTables.siteId, context.callerSiteId)] : [])
      )
    )
    .get();
  if (!table) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found for this tenant',
    });
  }
  const service = findOpenService(tx, tenantId, table.id);
  if (!service) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_NOT_OPEN',
      message: 'The table has no open service to regroup',
    });
  }
  if (service.siteId !== table.siteId) {
    conflict('Restaurant service site does not match its physical table');
  }
  assertNoUnnormalizedRestaurantDrafts(tx, tenantId, table.id);
  const kdsScope = { tenantId, siteId: table.siteId, actorId };

  const checks: CheckState[] = tx
    .select({
      id: restaurantChecks.id,
      openedAt: restaurantChecks.openedAt,
      version: restaurantChecks.version,
      sale: sales,
    })
    .from(restaurantChecks)
    .innerJoin(sales, and(eq(sales.id, restaurantChecks.saleId), eq(sales.tenantId, tenantId)))
    .where(
      and(
        eq(restaurantChecks.tenantId, tenantId),
        eq(restaurantChecks.serviceId, service.id),
        eq(restaurantChecks.status, 'open')
      )
    )
    .orderBy(asc(restaurantChecks.openedAt), asc(restaurantChecks.id))
    .all()
    .map(row => ({ ...row, created: false }));
  const firstCheck = checks[0];
  if (!firstCheck) conflict('Restaurant service has no open check');
  // The plan was built on the caller's view; any check opened, closed or
  // changed since then would be silently overwritten.
  const seen = new Map(args.checks.map(view => [view.checkId, view.version]));
  if (seen.size !== checks.length || checks.some(check => seen.get(check.id) !== check.version)) {
    stale('The open checks of this table changed since the plan was built');
  }
  const checkIds = checks.map(check => check.id);
  const saleIds = checks.map(check => check.sale.id);
  const checkById = new Map(checks.map(check => [check.id, check]));
  const checkOf = (id: string): CheckState =>
    checkById.get(id) ?? conflict('Restaurant line references a check outside its service');

  assertSalesNotExternallyBound(tx, tenantId, saleIds);
  const sessionSites = readCashSessionSites(tx, tenantId, [
    ...new Set(checks.flatMap(({ sale }) => (sale.cashSessionId ? [sale.cashSessionId] : []))),
  ]);
  for (const { sale } of checks) {
    if (sale.status !== 'draft' || !sale.suspendedAt) inUse(sale.id);
    if (sale.tableId !== table.id) conflict('Restaurant check sale is not parked at this table');
    assertDraftTenderDivisible(sale);
    if (sale.currencyCode !== firstCheck.sale.currencyCode) {
      invalidDraftSplit('Checks priced in different currencies cannot be regrouped');
    }
    assertDraftSessionAtTableSite(
      sale.cashSessionId ? sessionSites.get(sale.cashSessionId) : null,
      table.siteId
    );
    adoptLegacyKitchenSale(tx, kdsScope, sale.id);
  }

  const lines: LineState[] = tx
    .select({
      id: restaurantCheckLines.id,
      saleItemId: restaurantCheckLines.saleItemId,
      checkId: restaurantCheckLines.checkId,
      roundId: restaurantCheckLines.roundId,
      courseId: restaurantCheckLines.courseId,
      dinerId: restaurantCheckLines.dinerId,
      total: saleItems.total,
      taxAmount: saleItems.taxAmount,
    })
    .from(restaurantCheckLines)
    .innerJoin(
      restaurantChecks,
      and(
        eq(restaurantChecks.id, restaurantCheckLines.checkId),
        eq(restaurantChecks.tenantId, tenantId)
      )
    )
    .innerJoin(
      saleItems,
      and(
        eq(saleItems.id, restaurantCheckLines.saleItemId),
        eq(saleItems.saleId, restaurantChecks.saleId)
      )
    )
    .where(
      and(
        eq(restaurantCheckLines.tenantId, tenantId),
        inArray(restaurantCheckLines.checkId, checkIds)
      )
    )
    .orderBy(asc(restaurantCheckLines.createdAt), asc(restaurantCheckLines.id))
    .all()
    .map(line => ({
      ...line,
      grossCents: toCents(line.total),
      origin: checkOf(line.checkId),
      discountCents: 0,
      tipCents: 0,
      serviceCents: 0,
    }));
  const saleItemCount =
    tx
      .select({ value: count() })
      .from(saleItems)
      .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, tenantId)))
      .where(inArray(saleItems.saleId, saleIds))
      .get()?.value ?? 0;
  if (lines.length !== saleItemCount || lines.length > RESTAURANT_SERVICE_LIMITS.openLines) {
    conflict('Restaurant line metadata does not cover its tenant-scoped check sales');
  }

  // Freeze each draft's header onto its lines before anything moves.
  const linesBefore = groupBy(lines, line => line.checkId);
  for (const check of checks) {
    const own = linesBefore.get(check.id) ?? [];
    const { sale } = check;
    assertDraftHeaderMatchesLines(sale, {
      count: own.length,
      gross: fromCents(sumOf(own, line => line.grossCents)),
    });
    const weights = own.map(line => line.grossCents);
    const share = (amount: number): number[] =>
      allocateCentsByWeights(toCents(amount), weights) ??
      invalidDraftSplit('A draft line total cannot weigh its header amounts', { saleId: sale.id });
    const discount = share(sale.discountAmount);
    const tip = share(sale.tipAmount);
    const serviceCharge = share(sale.serviceChargeAmount);
    own.forEach((line, index) => {
      line.discountCents = discount[index] ?? 0;
      line.tipCents = tip[index] ?? 0;
      line.serviceCents = serviceCharge[index] ?? 0;
    });
  }

  const targets =
    args.plan.kind === 'byDiner'
      ? planByDiner(tx, tenantId, service.id, checks, lines)
      : planByAccounts(args.plan, checks, lines);

  const describe = (byCheck: Map<string, LineState[]>): RegroupChecksResult['checks'] =>
    [...checkById.values()]
      .filter(check => byCheck.has(check.id))
      .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id))
      .map(check => ({
        checkId: check.id,
        saleId: check.sale.id,
        saleNumber: check.sale.saleNumber,
        total: roundMoney(check.sale.total),
        saleItemIds: (byCheck.get(check.id) ?? []).map(line => line.saleItemId),
      }));

  const unchanged = targets.every(
    target => target.checkId !== null && target.lines.every(line => line.checkId === target.checkId)
  );
  if (unchanged) return { checks: describe(linesBefore), cancelledCheckIds: [] };
  if (targets.length > RESTAURANT_SERVICE_LIMITS.openChecks) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
      message: 'The regrouped service would exceed the maximum number of open checks',
      details: { maximumOpenChecks: RESTAURANT_SERVICE_LIMITS.openChecks },
    });
  }

  // Completion prices lines by the draft's tier and credits its customer, so
  // a line only joins a draft with the terms it was sold under.
  for (const target of targets) {
    const terms =
      target.checkId === null ? target.lines[0]?.origin.sale : checkOf(target.checkId).sale;
    if (
      terms &&
      target.lines.some(
        ({ origin }) =>
          origin.sale.priceTier !== terms.priceTier || origin.sale.customerId !== terms.customerId
      )
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SPLIT_TERMS_DIFFER',
        message: 'Lines cannot move between checks with a different price tier or customer',
      });
    }
  }

  const grandTotalBefore = sumOf(checks, check => toCents(check.sale.total));
  const beforeSummary = checks.map(check => ({
    checkId: check.id,
    lineCount: linesBefore.get(check.id)?.length ?? 0,
  }));

  // New accounts: a suspended draft per account, inheriting the header of
  // the source check that contributes most of its gross (the oldest on a tie).
  let sequentialId: string | undefined;
  let createdCount = 0;
  for (const target of targets) {
    if (target.checkId !== null) continue;
    const grossBySource = new Map<CheckState, number>();
    for (const line of target.lines) {
      grossBySource.set(line.origin, (grossBySource.get(line.origin) ?? 0) + line.grossCents);
    }
    const source = checks
      .filter(check => grossBySource.has(check))
      .reduce((best, check) =>
        (grossBySource.get(check) ?? 0) > (grossBySource.get(best) ?? 0) ? check : best
      );
    sequentialId ??= requireActiveSaleSequential(tx, { tenantId, siteId: table.siteId });
    const sale = insertSuspendedChildDraft(transaction, {
      tenantId,
      source: source.sale,
      sequentialId,
      tableId: table.id,
      label: table.name,
      actorId,
      now,
    });
    // Distinct opening instants keep the new accounts in plan order.
    const openedAt = new Date(Date.parse(now) + createdCount).toISOString();
    createdCount += 1;
    const checkId = nanoid();
    tx.insert(restaurantChecks)
      .values({
        id: checkId,
        tenantId,
        serviceId: service.id,
        saleId: sale.id,
        label: table.name,
        status: 'open',
        openedBy: actorId,
        openedAt,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    checkById.set(checkId, { id: checkId, openedAt, version: 1, sale, created: true });
    target.checkId = checkId;
  }

  const roundsByCheck = groupBy(
    tx
      .select()
      .from(restaurantRounds)
      .where(
        and(eq(restaurantRounds.tenantId, tenantId), inArray(restaurantRounds.checkId, checkIds))
      )
      .all(),
    round => round.checkId
  );
  const coursesByCheck = groupBy(
    tx
      .select()
      .from(restaurantCourses)
      .where(
        and(eq(restaurantCourses.tenantId, tenantId), inArray(restaurantCourses.checkId, checkIds))
      )
      .all(),
    course => course.checkId
  );
  const listFor = <T>(byCheck: Map<string, T[]>, checkId: string): T[] => {
    const existing = byCheck.get(checkId);
    if (existing) return existing;
    const created: T[] = [];
    byCheck.set(checkId, created);
    return created;
  };

  // Rounds are per check: reuse the target's copy of the same submission,
  // otherwise clone it, keeping the sequence when the target has it free.
  const resolveRound = (sourceCheckId: string, roundId: string, targetCheckId: string): string => {
    const source = listFor(roundsByCheck, sourceCheckId).find(round => round.id === roundId);
    if (!source) conflict('Restaurant round metadata is incomplete during the regroup');
    const targetRounds = listFor(roundsByCheck, targetCheckId);
    const sameSubmission = targetRounds.filter(
      round =>
        round.submittedAt === source.submittedAt &&
        round.submittedBy === source.submittedBy &&
        round.label === source.label &&
        round.status === source.status
    );
    const reused =
      sameSubmission.find(round => round.sequence === source.sequence) ?? sameSubmission[0];
    if (reused) return reused.id;
    const taken = new Set(targetRounds.map(round => round.sequence));
    const clone: RoundRow = cloneRestaurantRound(
      tx,
      source,
      targetCheckId,
      now,
      taken.has(source.sequence) ? Math.max(...taken) + 1 : source.sequence
    );
    targetRounds.push(clone);
    return clone.id;
  };
  const resolveCourse = (
    sourceCheckId: string,
    courseId: string,
    targetCheckId: string
  ): string => {
    const source = listFor(coursesByCheck, sourceCheckId).find(course => course.id === courseId);
    if (!source) conflict('Restaurant course metadata is incomplete during the regroup');
    const targetCourses = listFor(coursesByCheck, targetCheckId);
    const reused = targetCourses.find(course => course.courseKey === source.courseKey);
    if (reused) return reused.id;
    const taken = new Set(targetCourses.map(course => course.position));
    let position = source.position;
    while (taken.has(position)) position = (position + 1) % 21;
    const clone: CourseRow = cloneRestaurantCourse(tx, source, targetCheckId, now, position);
    targetCourses.push(clone);
    return clone.id;
  };

  // One guarded UPDATE pair per (source, target, round, course) group; the
  // changes count re-validates ownership inside the writer, like splitDraft.
  const moves = new Map<string, { source: CheckState; target: CheckState; lines: LineState[] }>();
  for (const target of targets) {
    if (target.checkId === null) continue;
    for (const line of target.lines) {
      if (line.checkId === target.checkId) continue;
      const key = [line.checkId, target.checkId, line.roundId, line.courseId].join('|');
      const move = moves.get(key);
      if (move) move.lines.push(line);
      else {
        moves.set(key, {
          source: checkOf(line.checkId),
          target: checkOf(target.checkId),
          lines: [line],
        });
      }
    }
  }
  const affected = new Set<CheckState>();
  const vacatedRoundIds = new Set<string>();
  const vacatedCourseIds = new Set<string>();
  for (const { source, target, lines: moved } of moves.values()) {
    const sample = moved[0];
    if (!sample) continue;
    const roundId = sample.roundId ? resolveRound(source.id, sample.roundId, target.id) : null;
    const courseId = sample.courseId ? resolveCourse(source.id, sample.courseId, target.id) : null;
    const movedItems = tx
      .update(saleItems)
      .set({ saleId: target.sale.id })
      .where(
        and(
          inArray(
            saleItems.id,
            moved.map(line => line.saleItemId)
          ),
          eq(saleItems.saleId, source.sale.id)
        )
      )
      .run();
    const movedLines = tx
      .update(restaurantCheckLines)
      .set({ checkId: target.id, roundId, courseId })
      .where(
        and(
          inArray(
            restaurantCheckLines.id,
            moved.map(line => line.id)
          ),
          eq(restaurantCheckLines.tenantId, tenantId),
          eq(restaurantCheckLines.checkId, source.id)
        )
      )
      .run();
    if (movedItems.changes !== moved.length || movedLines.changes !== moved.length) {
      stale('A line changed while the table was being regrouped');
    }
    if (sample.roundId) vacatedRoundIds.add(sample.roundId);
    if (sample.courseId) vacatedCourseIds.add(sample.courseId);
    affected.add(source).add(target);
    for (const line of moved) {
      line.checkId = target.id;
      line.roundId = roundId;
      line.courseId = courseId;
    }
  }

  const linesAfter = groupBy(lines, line => line.checkId);
  const surviving = [...affected].filter(check => linesAfter.has(check.id));
  const cancelled = [...affected].filter(check => !linesAfter.has(check.id));

  // Drop the round and course rows a surviving check no longer uses. A
  // kitchen line keeps the id of the round it was submitted in, so a round
  // the kitchen still names stays.
  const usedRoundIds = new Set(lines.flatMap(line => (line.roundId ? [line.roundId] : [])));
  const usedCourseIds = new Set(lines.flatMap(line => (line.courseId ? [line.courseId] : [])));
  const idleRoundIds = surviving.flatMap(check =>
    listFor(roundsByCheck, check.id)
      .filter(round => vacatedRoundIds.has(round.id) && !usedRoundIds.has(round.id))
      .map(round => round.id)
  );
  const idleCourseIds = surviving.flatMap(check =>
    listFor(coursesByCheck, check.id)
      .filter(course => vacatedCourseIds.has(course.id) && !usedCourseIds.has(course.id))
      .map(course => course.id)
  );
  if (idleRoundIds.length > 0) {
    const named = new Set(
      tx
        .select({ roundId: kdsOrderLines.roundId })
        .from(kdsOrderLines)
        .where(
          and(eq(kdsOrderLines.tenantId, tenantId), inArray(kdsOrderLines.roundId, idleRoundIds))
        )
        .all()
        .map(row => row.roundId)
    );
    const removable = idleRoundIds.filter(id => !named.has(id));
    if (removable.length > 0) {
      tx.delete(restaurantRounds)
        .where(
          and(eq(restaurantRounds.tenantId, tenantId), inArray(restaurantRounds.id, removable))
        )
        .run();
    }
  }
  if (idleCourseIds.length > 0) {
    tx.delete(restaurantCourses)
      .where(
        and(eq(restaurantCourses.tenantId, tenantId), inArray(restaurantCourses.id, idleCourseIds))
      )
      .run();
  }

  const stillSuspended = (saleId: string) =>
    and(
      eq(sales.id, saleId),
      eq(sales.tenantId, tenantId),
      eq(sales.status, 'draft'),
      isNotNull(sales.suspendedAt)
    );

  for (const check of surviving) {
    const own = linesAfter.get(check.id) ?? [];
    const taxCents = sumOf(own, line => toCents(line.taxAmount));
    const subtotal = fromCents(sumOf(own, line => line.grossCents) - taxCents);
    const taxAmount = fromCents(taxCents);
    const discountAmount = fromCents(sumOf(own, line => line.discountCents));
    const tipAmount = fromCents(sumOf(own, line => line.tipCents));
    const serviceChargeAmount = fromCents(sumOf(own, line => line.serviceCents));
    const total = roundMoney(
      fromCents(sumOf(own, line => line.grossCents)) -
        discountAmount +
        tipAmount +
        serviceChargeAmount
    );
    if (total < 0) {
      invalidDraftSplit('The suspended draft adjustments cannot be represented after the regroup', {
        saleId: check.sale.id,
        total,
      });
    }
    // A draft that had no tip or service charge of its own adopts the terms
    // of the first draft that brought one in.
    const donors = own.map(line => line.origin.sale);
    const tipMethod =
      check.sale.tipMethod ?? donors.find(sale => sale.tipMethod !== null)?.tipMethod ?? null;
    const serviceChargeRate =
      check.sale.serviceChargeRate ??
      donors.find(sale => sale.serviceChargeRate !== null)?.serviceChargeRate ??
      null;
    // A draft opened by this command keeps its first version, as in splitDraft.
    const syncVersion = check.created ? 1 : (check.sale.syncVersion ?? 0) + 1;
    const updated = tx
      .update(sales)
      .set({
        subtotal,
        taxAmount,
        discountAmount,
        tipAmount,
        tipMethod: tipAmount > 0 ? tipMethod : null,
        serviceChargeAmount,
        serviceChargeRate: serviceChargeAmount > 0 ? serviceChargeRate : null,
        total,
        paymentStatus: 'pending',
        syncStatus: 'pending',
        syncVersion,
        updatedAt: now,
      })
      .where(stillSuspended(check.sale.id))
      .run();
    if (updated.changes !== 1) inUse(check.sale.id);
    check.sale = { ...check.sale, total, syncVersion };
    // Cancelled checks get their bump from the close below.
    if (!check.created) {
      const bumped = tx
        .update(restaurantChecks)
        .set({ version: check.version + 1, updatedAt: now })
        .where(
          and(
            eq(restaurantChecks.id, check.id),
            eq(restaurantChecks.tenantId, tenantId),
            eq(restaurantChecks.status, 'open'),
            eq(restaurantChecks.version, check.version)
          )
        )
        .run();
      if (bumped.changes !== 1) stale('A check changed while the table was being regrouped');
    }
    rebuildProvisionalDraftPayment(tx, {
      tenantId,
      saleId: check.sale.id,
      method: check.sale.paymentMethod,
      amount: total,
      now,
    });
  }

  // A draft left without lines is cancelled the way a discard would, minus
  // the stock reversal: its reservations moved with the lines.
  for (const check of cancelled) {
    const syncVersion = (check.sale.syncVersion ?? 0) + 1;
    const updated = tx
      .update(sales)
      .set({
        status: 'cancelled',
        subtotal: 0,
        taxAmount: 0,
        discountAmount: 0,
        tipAmount: 0,
        tipMethod: null,
        serviceChargeAmount: 0,
        serviceChargeRate: null,
        total: 0,
        suspendedAt: null,
        suspendedBy: null,
        resumedBy: null,
        resumedDeviceId: null,
        suspendedLabel: null,
        syncStatus: 'pending',
        syncVersion,
        updatedAt: now,
      })
      .where(stillSuspended(check.sale.id))
      .run();
    if (updated.changes !== 1) inUse(check.sale.id);
    check.sale = { ...check.sale, status: 'cancelled', total: 0, syncVersion };
    rebuildProvisionalDraftPayment(tx, {
      tenantId,
      saleId: check.sale.id,
      method: check.sale.paymentMethod,
      amount: null,
      now,
    });
    closeRestaurantCheckForSale(
      tx,
      { tenantId, siteId: table.siteId, actorId, now },
      check.sale.id,
      'cancelled'
    );
  }

  const grandTotalAfter = sumOf([...checkById.values()], check => toCents(check.sale.total));
  if (grandTotalAfter !== grandTotalBefore) {
    invalidDraftSplit('Regrouping the checks would change the amount owed by the table', {
      before: fromCents(grandTotalBefore),
      after: fromCents(grandTotalAfter),
    });
  }

  // Relocate kitchen lines to their new drafts first; the cancelled drafts
  // then have nothing left to void.
  for (const check of surviving) {
    reconcileKitchenSaleInTransaction(tx, kdsScope, check.sale.id);
  }
  for (const check of cancelled) {
    reconcileKitchenSaleInTransaction(tx, kdsScope, check.sale.id, 'discard');
  }

  const syncContext = {
    db: tx,
    tenantId,
    envelope: context.envelope ?? null,
    deviceId: context.deviceId ?? null,
  };
  for (const { sale, created } of [...surviving, ...cancelled]) {
    enqueueSyncInTransaction(syncContext, {
      entityType: 'sales',
      entityId: sale.id,
      operation: created ? 'create' : 'update',
      data: {
        id: sale.id,
        saleNumber: sale.saleNumber,
        status: sale.status,
        tableId: table.id,
        regroupedServiceId: service.id,
        syncVersion: sale.syncVersion,
      },
    });
  }

  const result: RegroupChecksResult = {
    checks: describe(linesAfter),
    cancelledCheckIds: cancelled.map(check => check.id),
  };
  writeAuditLog({
    tx,
    tenantId,
    actorId,
    action: 'restaurant.checks.regrouped',
    resourceType: 'restaurant_service',
    resourceId: service.id,
    operationId: context.envelope?.operationId,
    metadata: {
      siteId: table.siteId,
      tableId: table.id,
      planKind: args.plan.kind,
      before: beforeSummary,
      after: result.checks.map(check => ({
        checkId: check.checkId,
        lineCount: check.saleItemIds.length,
      })),
      cancelledCheckIds: result.cancelledCheckIds,
    },
  });
  return result;
}
