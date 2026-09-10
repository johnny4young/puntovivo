/** Current catalog authority is checked only for new orders, under the existing sale writer. */
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { restaurantModifierCatalog, sites, tenants, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { isModuleActiveInSettings } from '../../services/modules/manifest.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import {
  MAX_ACTIVE_RESTAURANT_MODIFIERS,
  type SaveRestaurantModifierInput,
} from '../../trpc/schemas/restaurantModifiers.js';
import type { RestaurantOrderLineInput } from './service-lifecycle.js';

/** Never reveal whether an unavailable reference exists in another tenant or site. */
function unavailable(): never {
  return throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'RESTAURANT_MODIFIER_UNAVAILABLE',
    message: 'Modifier is unavailable for this site',
  });
}
function requireSite(db: DatabaseInstance, tenantId: string, siteId: string): void {
  if (
    !db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.id, siteId), eq(sites.isActive, true)))
      .get()
  )
    unavailable();
}
function currentActor(db: DatabaseInstance, tenantId: string, actorId: string) {
  const actor = db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, actorId), eq(users.isActive, true)))
    .get();
  if (!actor || !['admin', 'manager', 'cashier'].includes(actor.role)) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'RESTAURANT_MODIFIER_APPROVAL_REQUIRED',
      message: 'An authorized restaurant operator is required',
    });
  }
  return actor;
}
function changed(): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'RESTAURANT_MODIFIER_CHANGED',
    message: 'Modifier configuration changed; refresh the selection',
  });
}

/** Save configuration plus audit and the canonical replay response in one immediate transaction. */
export function saveRestaurantModifier(
  ctx: CriticalCommandContext,
  input: SaveRestaurantModifierInput
) {
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      requireSite(tx, ctx.tenantId, input.siteId);
      const actor = currentActor(tx, ctx.tenantId, ctx.user.id);
      if (actor.role === 'cashier')
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'RESTAURANT_MODIFIER_APPROVAL_REQUIRED',
          message: 'Only managers may configure modifiers',
        });
      const tenant = tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      if (!isModuleActiveInSettings(tenant?.settings, 'dine-in'))
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'MODULE_NOT_ACTIVATED',
          message: 'Dine-in is not active',
        });
      const scope = and(
        eq(restaurantModifierCatalog.tenantId, ctx.tenantId),
        eq(restaurantModifierCatalog.siteId, input.siteId)
      );
      const before = input.id
        ? tx
            .select()
            .from(restaurantModifierCatalog)
            .where(and(scope, eq(restaurantModifierCatalog.id, input.id)))
            .get()
        : undefined;
      if (input.id && !before) unavailable();
      if ((before?.version ?? 0) !== input.expectedVersion) changed();
      if (input.isActive && !before?.isActive) {
        const active = tx
          .select({ value: count() })
          .from(restaurantModifierCatalog)
          .where(and(scope, eq(restaurantModifierCatalog.isActive, true)))
          .get()!.value;
        if (active >= MAX_ACTIVE_RESTAURANT_MODIFIERS)
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_MODIFIER_LIMIT_REACHED',
            message: 'The active modifier catalog limit has been reached',
          });
      }
      const nameKey = input.name.toLowerCase();
      if (
        input.isActive &&
        tx
          .select({ id: restaurantModifierCatalog.id })
          .from(restaurantModifierCatalog)
          .where(
            and(
              scope,
              eq(restaurantModifierCatalog.nameKey, nameKey),
              eq(restaurantModifierCatalog.isActive, true),
              before ? ne(restaurantModifierCatalog.id, before.id) : undefined
            )
          )
          .get()
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_MODIFIER_NAME_DUPLICATE',
          message: 'An active modifier with this name already exists',
        });
      }
      const patch = {
        name: input.name,
        nameKey,
        unitPriceDelta: input.unitPriceDelta,
        maxQuantity: input.maxQuantity,
        requiresManager: input.requiresManager,
        isActive: input.isActive,
        version: input.expectedVersion + 1,
        updatedBy: ctx.user.id,
        updatedAt: new Date().toISOString(),
      };
      const row = before
        ? tx
            .update(restaurantModifierCatalog)
            .set(patch)
            .where(
              and(
                scope,
                eq(restaurantModifierCatalog.id, before.id),
                eq(restaurantModifierCatalog.version, input.expectedVersion)
              )
            )
            .returning()
            .get()
        : tx
            .insert(restaurantModifierCatalog)
            .values({
              ...patch,
              id: nanoid(),
              tenantId: ctx.tenantId,
              siteId: input.siteId,
              createdBy: ctx.user.id,
            })
            .returning()
            .get();
      if (!row) changed();
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'restaurant_modifier.save',
        resourceType: 'restaurant_modifier',
        resourceId: row.id,
        before: before ?? null,
        after: row,
        operationId: ctx.envelope.operationId,
        metadata: { siteId: input.siteId },
      });
      ctx.completeInTransaction(tx, row);
      return row;
    },
    { behavior: 'immediate' }
  );
}

/** Verify the already-priced order, never change its prices after tax/stock rows were computed. */
export function assertRestaurantModifierAuthority(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string; actorId: string },
  lines: readonly RestaurantOrderLineInput[]
): void {
  const modifiers = lines.flatMap(line => line.modifiers);
  if (modifiers.length === 0) return;
  const actor = currentActor(db, scope.tenantId, scope.actorId);
  const privileged = actor.role === 'admin' || actor.role === 'manager';
  const ids = [...new Set(modifiers.flatMap(row => (row.catalogId ? [row.catalogId] : [])))];
  const entries = ids.length
    ? db
        .select()
        .from(restaurantModifierCatalog)
        .where(
          and(
            eq(restaurantModifierCatalog.tenantId, scope.tenantId),
            eq(restaurantModifierCatalog.siteId, scope.siteId),
            inArray(restaurantModifierCatalog.id, ids)
          )
        )
        .all()
    : [];
  const byId = new Map(entries.map(row => [row.id, row]));
  for (const modifier of modifiers) {
    if (!modifier.catalogId) {
      if (!privileged && roundMoney(modifier.unitPriceDelta) !== 0)
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'RESTAURANT_MODIFIER_APPROVAL_REQUIRED',
          message: 'Use a catalog modifier for a priced add-on',
        });
      continue;
    }
    const row = byId.get(modifier.catalogId);
    if (!row || !row.isActive) unavailable();
    if (row.requiresManager && !privileged)
      throwServerError({
        trpcCode: 'FORBIDDEN',
        errorCode: 'RESTAURANT_MODIFIER_APPROVAL_REQUIRED',
        message: 'This modifier requires a manager',
      });
    if (
      row.version !== modifier.catalogVersion ||
      row.name !== modifier.name.trim() ||
      row.unitPriceDelta !== roundMoney(modifier.unitPriceDelta) ||
      modifier.quantity > row.maxQuantity
    )
      changed();
  }
}
