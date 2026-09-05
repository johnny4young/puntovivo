/** Private employment ledger. The transport must gate administrators before command replay. */
import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { z } from 'zod';
import {
  createEmploymentContractInput,
  endEmploymentContractInput,
  replaceEmploymentContractInput,
  voidEmploymentContractInput,
  type EmploymentContractTarget,
} from '../../trpc/schemas/workforce.js';
import type { DatabaseInstance } from '../../db/index.js';
import {
  employmentContracts,
  employmentContractEvents,
  sites,
  tenants,
  users,
  type EmploymentContractRow,
  type EmploymentContractSnapshot,
} from '../../db/schema.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import { type EmploymentContractTerms } from '../../services/labor/employment-contract.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';

/** Narrow transaction capability, supplied only after administrator and command-envelope guards. */
export type EmploymentContractCommandContext = Pick<
  CriticalCommandContext,
  'db' | 'tenantId' | 'user' | 'envelope' | 'completeInTransaction'
> & { deviceId?: string };

/** Internal domain failures; the transport maps these to safe localized server errors. */
export class EmploymentContractError extends Error {
  constructor(
    readonly reason: 'forbidden' | 'not_found' | 'currency' | 'overlap' | 'version' | 'state'
  ) {
    super(`Employment contract ${reason}`);
    this.name = 'EmploymentContractError';
  }
}

/** Bounded replay result: never cache compensation or private employment notes in the command journal. */
type ContractResult = { id: string; siteId: string; version: number };

function deny(reason: EmploymentContractError['reason']): never {
  throw new EmploymentContractError(reason);
}

async function withContract<T>(
  ctx: EmploymentContractCommandContext,
  action: (tx: DatabaseInstance, timeZone: string) => T
): Promise<T> {
  if (ctx.user.role !== 'admin') deny('forbidden');
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const actor = tx
        .select({ role: users.role })
        .from(users)
        .where(
          and(eq(users.tenantId, ctx.tenantId), eq(users.id, ctx.user.id), eq(users.isActive, true))
        )
        .get();
      if (actor?.role !== 'admin') deny('forbidden');
      if (
        !tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(and(eq(tenants.id, ctx.tenantId), eq(tenants.isActive, true)))
          .get()
      )
        deny('not_found');
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      return action(tx, clock.timezone);
    },
    { behavior: 'immediate' }
  );
}

function assertSite(tx: DatabaseInstance, tenantId: string, siteId: string, activeOnly = true) {
  if (
    !tx
      .select({ id: sites.id })
      .from(sites)
      .where(
        and(
          eq(sites.tenantId, tenantId),
          eq(sites.id, siteId),
          ...(activeOnly ? [eq(sites.isActive, true)] : [])
        )
      )
      .get()
  )
    deny('not_found');
}

function assertTerms(
  tx: DatabaseInstance,
  tenantId: string,
  terms: EmploymentContractTerms,
  excludingId?: string
) {
  assertSite(tx, tenantId, terms.siteId);
  if (
    !tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.tenantId, tenantId), eq(users.id, terms.userId), eq(users.isActive, true))
      )
      .get()
  )
    deny('not_found');
  const tenant = tx
    .select({ currency: tenants.defaultCurrencyCode })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.isActive, true)))
    .get();
  if (!tenant) deny('not_found');
  if (tenant.currency !== terms.currencyCode) deny('currency');
  // One effective employment assignment per employee across ALL sites. Reserving
  // the SQLite writer before this range query prevents concurrent overlapping terms.
  const overlapping = tx
    .select({ id: employmentContracts.id })
    .from(employmentContracts)
    .where(
      and(
        eq(employmentContracts.tenantId, tenantId),
        eq(employmentContracts.userId, terms.userId),
        isNull(employmentContracts.voidedAt),
        or(
          isNull(employmentContracts.effectiveUntil),
          gt(employmentContracts.effectiveUntil, terms.effectiveFrom)
        ),
        ...(terms.effectiveUntil === null
          ? []
          : [lt(employmentContracts.effectiveFrom, terms.effectiveUntil)]),
        ...(excludingId ? [ne(employmentContracts.id, excludingId)] : [])
      )
    )
    .get();
  if (overlapping) deny('overlap');
}

function requireContract(tx: DatabaseInstance, tenantId: string, input: EmploymentContractTarget) {
  // Archiving a site must not strand existing contracts. Closing or correcting
  // their evidence remains available; creating replacement terms needs an active site.
  assertSite(tx, tenantId, input.siteId, false);
  const row = tx
    .select()
    .from(employmentContracts)
    .where(
      and(
        eq(employmentContracts.tenantId, tenantId),
        eq(employmentContracts.siteId, input.siteId),
        eq(employmentContracts.id, input.id)
      )
    )
    .get();
  if (!row) deny('not_found');
  if (row.version !== input.expectedVersion) deny('version');
  if (row.voidedAt !== null) deny('state');
  return row;
}

function snapshot(row: EmploymentContractRow): EmploymentContractSnapshot {
  return {
    terms: {
      userId: row.userId,
      siteId: row.siteId,
      position: row.position,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      currencyCode: row.currencyCode,
      pay:
        row.payBasis === 'hourly'
          ? { basis: 'hourly', amount: row.payAmount }
          : { basis: 'monthly', amount: row.payAmount, costingHourlyRate: row.costingHourlyRate },
    },
    timeZone: row.timeZone,
    version: row.version,
    voidedAt: row.voidedAt,
  };
}

function record(
  tx: DatabaseInstance,
  ctx: EmploymentContractCommandContext,
  row: EmploymentContractRow,
  before: EmploymentContractRow | null,
  kind: typeof employmentContractEvents.$inferInsert.kind,
  reason: string
) {
  tx.insert(employmentContractEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      siteId: row.siteId,
      contractId: row.id,
      version: row.version,
      kind,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      reason,
      before: before ? snapshot(before) : null,
      after: snapshot(row),
      createdAt: row.updatedAt,
    })
    .run();
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'employment_contract.changed',
    resourceType: 'employment_contract',
    resourceId: row.id,
    before: before ? { version: before.version } : null,
    after: { version: row.version, kind, siteId: row.siteId },
  });
  enqueueSyncInTransaction(
    { db: tx, tenantId: ctx.tenantId, deviceId: ctx.deviceId ?? null, envelope: ctx.envelope },
    {
      entityType: 'employment_contracts',
      entityId: row.id,
      operation: before ? 'update' : 'create',
      data: { id: row.id, siteId: row.siteId, version: row.version, kind },
    }
  );
}

function insertTerms(
  tx: DatabaseInstance,
  ctx: EmploymentContractCommandContext,
  terms: EmploymentContractTerms,
  timeZone: string,
  reason: string,
  predecessorId: string | null = null
) {
  const now = new Date().toISOString();
  const row = tx
    .insert(employmentContracts)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      userId: terms.userId,
      siteId: terms.siteId,
      position: terms.position,
      effectiveFrom: terms.effectiveFrom,
      effectiveUntil: terms.effectiveUntil,
      currencyCode: terms.currencyCode,
      payBasis: terms.pay.basis,
      payAmount: terms.pay.amount,
      costingHourlyRate: terms.pay.basis === 'monthly' ? terms.pay.costingHourlyRate : null,
      timeZone,
      predecessorId,
      createdByUserId: ctx.user.id,
      updatedByUserId: ctx.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()!;
  record(tx, ctx, row, null, 'created', reason);
  return row;
}

function changeWindow(
  tx: DatabaseInstance,
  ctx: EmploymentContractCommandContext,
  before: EmploymentContractRow,
  changes: { effectiveUntil?: string; voidedAt?: string },
  kind: 'ended' | 'replaced' | 'voided',
  reason: string
) {
  const row = tx
    .update(employmentContracts)
    .set({
      ...changes,
      version: before.version + 1,
      updatedByUserId: ctx.user.id,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(employmentContracts.tenantId, ctx.tenantId),
        eq(employmentContracts.id, before.id),
        eq(employmentContracts.version, before.version),
        isNull(employmentContracts.voidedAt)
      )
    )
    .returning()
    .get();
  if (!row) deny('version');
  record(tx, ctx, row, before, kind, reason);
  return row;
}

function finish(
  ctx: EmploymentContractCommandContext,
  tx: DatabaseInstance,
  row: EmploymentContractRow
): ContractResult {
  const result = { id: row.id, siteId: row.siteId, version: row.version };
  ctx.completeInTransaction(tx, result);
  return result;
}

export async function createEmploymentContract(
  ctx: EmploymentContractCommandContext,
  raw: z.input<typeof createEmploymentContractInput>
) {
  const input = createEmploymentContractInput.parse(raw);
  return withContract(ctx, (tx, timeZone) => {
    assertTerms(tx, ctx.tenantId, input.terms);
    return finish(ctx, tx, insertTerms(tx, ctx, input.terms, timeZone, input.reason));
  });
}

export async function endEmploymentContract(
  ctx: EmploymentContractCommandContext,
  raw: z.input<typeof endEmploymentContractInput>
) {
  const input = endEmploymentContractInput.parse(raw);
  return withContract(ctx, tx => {
    const before = requireContract(tx, ctx.tenantId, input);
    if (
      input.effectiveUntil <= before.effectiveFrom ||
      (before.effectiveUntil !== null && input.effectiveUntil >= before.effectiveUntil)
    )
      deny('state');
    return finish(
      ctx,
      tx,
      changeWindow(tx, ctx, before, { effectiveUntil: input.effectiveUntil }, 'ended', input.reason)
    );
  });
}

export async function voidEmploymentContract(
  ctx: EmploymentContractCommandContext,
  raw: z.input<typeof voidEmploymentContractInput>
) {
  const input = voidEmploymentContractInput.parse(raw);
  return withContract(ctx, tx => {
    const before = requireContract(tx, ctx.tenantId, input);
    return finish(
      ctx,
      tx,
      changeWindow(tx, ctx, before, { voidedAt: new Date().toISOString() }, 'voided', input.reason)
    );
  });
}

export async function replaceEmploymentContract(
  ctx: EmploymentContractCommandContext,
  raw: z.input<typeof replaceEmploymentContractInput>
) {
  const input = replaceEmploymentContractInput.parse(raw);
  return withContract(ctx, tx => {
    const before = requireContract(tx, ctx.tenantId, input);
    // Reprice/relocate only the remaining interval, never silently extend the
    // contract, change its employee, or leave a gap by ending before creation.
    if (
      input.terms.userId !== before.userId ||
      input.terms.effectiveFrom <= before.effectiveFrom ||
      (before.effectiveUntil !== null && input.terms.effectiveFrom >= before.effectiveUntil) ||
      input.terms.effectiveUntil !== before.effectiveUntil
    )
      deny('state');
    assertTerms(tx, ctx.tenantId, input.terms, before.id);
    changeWindow(
      tx,
      ctx,
      before,
      { effectiveUntil: input.terms.effectiveFrom },
      'replaced',
      input.reason
    );
    const row = insertTerms(tx, ctx, input.terms, before.timeZone, input.reason, before.id);
    return finish(ctx, tx, row);
  });
}
