/** Site-local modifier groups: how a dish asks for its options, checked again on every order. */
import { and, asc, count, eq, inArray, ne, sum } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  products,
  restaurantModifierCatalog,
  restaurantModifierGroupItems,
  restaurantModifierGroupKindEnum,
  restaurantModifierGroups,
  restaurantProductModifierGroups,
  type RestaurantModifierGroupKind,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import {
  MAX_ACTIVE_RESTAURANT_MODIFIER_GROUPS,
  MAX_RESTAURANT_GROUP_OPTIONS,
  MAX_RESTAURANT_GROUPS_PER_PRODUCT,
  type SaveRestaurantModifierGroupInput,
} from '../../trpc/schemas/restaurantModifiers.js';
import { assertModifierConfigWrite, changed, unavailable } from './modifier-catalog.js';

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}
/** Archiving an option can leave fewer than the minimum; the dish stays orderable. */
function effectiveMinimum(minSelections: number, options: readonly { isActive: boolean }[]) {
  return Math.min(minSelections, options.filter(option => option.isActive).length);
}

/** Option projection shared by the editor and the plate sheet; never employee or audit fields. */
const optionColumns = {
  groupId: restaurantModifierGroupItems.groupId,
  position: restaurantModifierGroupItems.position,
  catalogId: restaurantModifierCatalog.id,
  name: restaurantModifierCatalog.name,
  unitPriceDelta: restaurantModifierCatalog.unitPriceDelta,
  maxQuantity: restaurantModifierCatalog.maxQuantity,
  requiresManager: restaurantModifierCatalog.requiresManager,
  isActive: restaurantModifierCatalog.isActive,
  version: restaurantModifierCatalog.version,
};
const groupColumns = {
  id: restaurantModifierGroups.id,
  siteId: restaurantModifierGroups.siteId,
  name: restaurantModifierGroups.name,
  kind: restaurantModifierGroups.kind,
  selection: restaurantModifierGroups.selection,
  minSelections: restaurantModifierGroups.minSelections,
  maxSelections: restaurantModifierGroups.maxSelections,
  isActive: restaurantModifierGroups.isActive,
  version: restaurantModifierGroups.version,
};
function optionsByGroup(db: DatabaseInstance, tenantId: string, groupIds: string[]) {
  const rows = groupIds.length
    ? db
        .select(optionColumns)
        .from(restaurantModifierGroupItems)
        .innerJoin(
          restaurantModifierCatalog,
          and(
            eq(restaurantModifierCatalog.id, restaurantModifierGroupItems.catalogId),
            eq(restaurantModifierCatalog.tenantId, tenantId)
          )
        )
        .where(
          and(
            eq(restaurantModifierGroupItems.tenantId, tenantId),
            inArray(restaurantModifierGroupItems.groupId, groupIds)
          )
        )
        .orderBy(asc(restaurantModifierGroupItems.position))
        .all()
    : [];
  const byGroup = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) pushTo(byGroup, row.groupId, row);
  return byGroup;
}

function sortForSheet<T extends { kind: RestaurantModifierGroupKind; name: string }>(rows: T[]) {
  // The kind enum order is the plate-sheet order: preparation, removals, extras.
  const rank = (kind: RestaurantModifierGroupKind) => restaurantModifierGroupKindEnum.indexOf(kind);
  return rows.sort((a, b) => rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name));
}

/** Editor list: every group of the site with all its options and how many dishes use it. */
export function listRestaurantModifierGroups(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string; includeArchived: boolean }
) {
  const groups = db
    .select(groupColumns)
    .from(restaurantModifierGroups)
    .where(
      and(
        eq(restaurantModifierGroups.tenantId, scope.tenantId),
        eq(restaurantModifierGroups.siteId, scope.siteId),
        scope.includeArchived ? undefined : eq(restaurantModifierGroups.isActive, true)
      )
    )
    .all();
  const ids = groups.map(group => group.id);
  const options = optionsByGroup(db, scope.tenantId, ids);
  const assigned = ids.length
    ? db
        .select({
          groupId: restaurantProductModifierGroups.groupId,
          productId: products.id,
          name: products.name,
        })
        .from(restaurantProductModifierGroups)
        .innerJoin(
          products,
          and(
            eq(products.id, restaurantProductModifierGroups.productId),
            eq(products.tenantId, scope.tenantId)
          )
        )
        .where(
          and(
            eq(restaurantProductModifierGroups.tenantId, scope.tenantId),
            inArray(restaurantProductModifierGroups.groupId, ids)
          )
        )
        .orderBy(asc(products.name))
        .all()
    : [];
  const productsByGroup = new Map<string, { id: string; name: string }[]>();
  for (const row of assigned)
    pushTo(productsByGroup, row.groupId, { id: row.productId, name: row.name });
  return sortForSheet(
    groups.map(group => ({
      ...group,
      options: options.get(group.id) ?? [],
      products: productsByGroup.get(group.id) ?? [],
    }))
  );
}

/** Plate-sheet read: active groups of one dish with their selectable options only. */
export function restaurantModifierGroupsForProduct(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string },
  productId: string
) {
  const groups = activeGroupsForProducts(db, scope, [productId]).get(productId) ?? [];
  const options = optionsByGroup(
    db,
    scope.tenantId,
    groups.map(group => group.id)
  );
  return groups.map(group => {
    const groupOptions = options.get(group.id) ?? [];
    return {
      ...group,
      minSelections: effectiveMinimum(group.minSelections, groupOptions),
      options: groupOptions
        .filter(option => option.isActive)
        .map(({ groupId: _groupId, isActive: _isActive, ...option }) => option),
    };
  });
}

function activeGroupsForProducts(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string },
  productIds: string[]
) {
  const rows = productIds.length
    ? db
        .select({ productId: restaurantProductModifierGroups.productId, ...groupColumns })
        .from(restaurantProductModifierGroups)
        .innerJoin(
          restaurantModifierGroups,
          eq(restaurantModifierGroups.id, restaurantProductModifierGroups.groupId)
        )
        .where(
          and(
            eq(restaurantProductModifierGroups.tenantId, scope.tenantId),
            inArray(restaurantProductModifierGroups.productId, productIds),
            eq(restaurantModifierGroups.tenantId, scope.tenantId),
            eq(restaurantModifierGroups.siteId, scope.siteId),
            eq(restaurantModifierGroups.isActive, true)
          )
        )
        .all()
    : [];
  const byProduct = new Map<string, Omit<(typeof rows)[number], 'productId'>[]>();
  for (const { productId, ...group } of rows) pushTo(byProduct, productId, group);
  for (const groups of byProduct.values()) sortForSheet(groups);
  return byProduct;
}

/** Save the rule, its ordered options and its dishes with audit and replay in one transaction. */
export function saveRestaurantModifierGroup(
  ctx: CriticalCommandContext,
  input: SaveRestaurantModifierGroupInput
) {
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      assertModifierConfigWrite(tx, {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        actorId: ctx.user.id,
      });
      const scope = and(
        eq(restaurantModifierGroups.tenantId, ctx.tenantId),
        eq(restaurantModifierGroups.siteId, input.siteId)
      );
      const before = input.id
        ? tx
            .select()
            .from(restaurantModifierGroups)
            .where(and(scope, eq(restaurantModifierGroups.id, input.id)))
            .get()
        : undefined;
      if (input.id && !before) unavailable();
      if ((before?.version ?? 0) !== input.expectedVersion) changed();
      if (input.isActive && !before?.isActive) {
        const active = tx
          .select({ value: count() })
          .from(restaurantModifierGroups)
          .where(and(scope, eq(restaurantModifierGroups.isActive, true)))
          .get()!.value;
        if (active >= MAX_ACTIVE_RESTAURANT_MODIFIER_GROUPS)
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_MODIFIER_GROUP_LIMIT_REACHED',
            message: 'The active modifier group limit has been reached',
          });
      }
      const nameKey = input.name.toLowerCase();
      if (
        input.isActive &&
        tx
          .select({ id: restaurantModifierGroups.id })
          .from(restaurantModifierGroups)
          .where(
            and(
              scope,
              eq(restaurantModifierGroups.nameKey, nameKey),
              eq(restaurantModifierGroups.isActive, true),
              before ? ne(restaurantModifierGroups.id, before.id) : undefined
            )
          )
          .get()
      )
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'RESTAURANT_MODIFIER_GROUP_NAME_DUPLICATE',
          message: 'An active modifier group with this name already exists',
        });

      // Options keep their catalog rows; an archived one may stay listed but never be added.
      const keptOptions = new Set(
        before
          ? tx
              .select({ catalogId: restaurantModifierGroupItems.catalogId })
              .from(restaurantModifierGroupItems)
              .where(
                and(
                  eq(restaurantModifierGroupItems.tenantId, ctx.tenantId),
                  eq(restaurantModifierGroupItems.groupId, before.id)
                )
              )
              .orderBy(asc(restaurantModifierGroupItems.position))
              .all()
              .map(row => row.catalogId)
          : []
      );
      const catalog = tx
        .select({ id: restaurantModifierCatalog.id, isActive: restaurantModifierCatalog.isActive })
        .from(restaurantModifierCatalog)
        .where(
          and(
            eq(restaurantModifierCatalog.tenantId, ctx.tenantId),
            eq(restaurantModifierCatalog.siteId, input.siteId),
            inArray(restaurantModifierCatalog.id, input.catalogIds)
          )
        )
        .all();
      const catalogById = new Map(catalog.map(row => [row.id, row]));
      for (const id of input.catalogIds) {
        const row = catalogById.get(id);
        if (!row || (!row.isActive && !keptOptions.has(id))) unavailable();
      }
      const selectable = input.catalogIds.filter(id => catalogById.get(id)!.isActive).length;
      if (input.isActive && input.minSelections > selectable)
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'RESTAURANT_MODIFIER_GROUP_INVALID',
          message: 'The minimum needs that many available options',
          details: { minSelections: input.minSelections, available: selectable },
        });

      const keptProducts = new Set(
        before
          ? tx
              .select({ productId: restaurantProductModifierGroups.productId })
              .from(restaurantProductModifierGroups)
              .where(
                and(
                  eq(restaurantProductModifierGroups.tenantId, ctx.tenantId),
                  eq(restaurantProductModifierGroups.groupId, before.id)
                )
              )
              .all()
              .map(row => row.productId)
          : []
      );
      const dishes = input.productIds.length
        ? tx
            .select({
              id: products.id,
              isActive: products.isActive,
              catalogType: products.catalogType,
            })
            .from(products)
            .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, input.productIds)))
            .all()
        : [];
      const dishById = new Map(dishes.map(row => [row.id, row]));
      for (const id of input.productIds) {
        const dish = dishById.get(id);
        // Sales reference the sellable variant, so a group on a variant parent would never show.
        if (
          !dish ||
          dish.catalogType === 'variant_parent' ||
          (dish.isActive === false && !keptProducts.has(id))
        )
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'RESTAURANT_MODIFIER_GROUP_PRODUCT_UNAVAILABLE',
            message: 'A dish is unavailable for this group',
          });
      }
      if (input.isActive) {
        // One order line holds at most 20 modifiers, so a dish's minimums must fit in it.
        const crowded = input.productIds.length
          ? tx
              .select({
                productId: restaurantProductModifierGroups.productId,
                groups: count(),
                minimums: sum(restaurantModifierGroups.minSelections).mapWith(Number),
              })
              .from(restaurantProductModifierGroups)
              .innerJoin(
                restaurantModifierGroups,
                eq(restaurantModifierGroups.id, restaurantProductModifierGroups.groupId)
              )
              .where(
                and(
                  scope,
                  eq(restaurantModifierGroups.isActive, true),
                  inArray(restaurantProductModifierGroups.productId, input.productIds),
                  before ? ne(restaurantModifierGroups.id, before.id) : undefined
                )
              )
              .groupBy(restaurantProductModifierGroups.productId)
              .all()
              .filter(
                row =>
                  row.groups >= MAX_RESTAURANT_GROUPS_PER_PRODUCT ||
                  row.minimums + input.minSelections > MAX_RESTAURANT_GROUP_OPTIONS
              )
          : [];
        if (crowded.length)
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_MODIFIER_GROUP_LIMIT_REACHED',
            message: 'A dish already shows the maximum number of groups or required choices',
            details: {
              productIds: crowded.map(row => row.productId),
              maxGroups: MAX_RESTAURANT_GROUPS_PER_PRODUCT,
              maxRequired: MAX_RESTAURANT_GROUP_OPTIONS,
            },
          });
      }

      const now = new Date().toISOString();
      const patch = {
        name: input.name,
        nameKey,
        kind: input.kind,
        selection: input.selection,
        minSelections: input.minSelections,
        maxSelections: input.maxSelections,
        isActive: input.isActive,
        version: input.expectedVersion + 1,
        updatedBy: ctx.user.id,
        updatedAt: now,
      };
      const row = before
        ? tx
            .update(restaurantModifierGroups)
            .set(patch)
            .where(
              and(
                scope,
                eq(restaurantModifierGroups.id, before.id),
                eq(restaurantModifierGroups.version, input.expectedVersion)
              )
            )
            .returning()
            .get()
        : tx
            .insert(restaurantModifierGroups)
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

      tx.delete(restaurantModifierGroupItems)
        .where(
          and(
            eq(restaurantModifierGroupItems.tenantId, ctx.tenantId),
            eq(restaurantModifierGroupItems.groupId, row.id)
          )
        )
        .run();
      tx.insert(restaurantModifierGroupItems)
        .values(
          input.catalogIds.map((catalogId, position) => ({
            id: nanoid(),
            tenantId: ctx.tenantId,
            groupId: row.id,
            catalogId,
            position,
          }))
        )
        .run();
      tx.delete(restaurantProductModifierGroups)
        .where(
          and(
            eq(restaurantProductModifierGroups.tenantId, ctx.tenantId),
            eq(restaurantProductModifierGroups.groupId, row.id)
          )
        )
        .run();
      if (input.productIds.length)
        tx.insert(restaurantProductModifierGroups)
          .values(
            input.productIds.map(productId => ({
              id: nanoid(),
              tenantId: ctx.tenantId,
              groupId: row.id,
              productId,
              createdAt: now,
            }))
          )
          .run();

      const result = { ...row, catalogIds: input.catalogIds, productIds: input.productIds };
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'restaurant_modifier_group.save',
        resourceType: 'restaurant_modifier_group',
        resourceId: row.id,
        before: before
          ? { ...before, catalogIds: [...keptOptions], productIds: [...keptProducts] }
          : null,
        after: result,
        operationId: ctx.envelope.operationId,
        metadata: { siteId: input.siteId },
      });
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

/** One order line as the group check sees it. */
export interface GroupedOrderLine {
  productId: string;
  /** Groups the client showed for the dish; present means minimums apply. */
  modifierGroups?: readonly { id: string; version: number }[] | undefined;
  modifiers: readonly {
    catalogId?: string | undefined;
    groupId?: string | undefined;
    quantity: number;
  }[];
}

/** Group an order modifier counted against, frozen on the line. */
export interface ResolvedModifierGroup {
  id: string;
  kind: RestaurantModifierGroupKind;
}

/**
 * Check each line against its dish's active groups and return, per line and modifier, the group
 * to freeze. A catalog option sent without a group counts against the dish's only group that
 * lists it, so maximums and removals hold on paths that never show groups. Minimums apply when
 * the line declares the groups it showed.
 */
export function assertRestaurantModifierGroups(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string },
  lines: readonly GroupedOrderLine[]
): (ResolvedModifierGroup | null)[][] {
  const resolved = lines.map(line => line.modifiers.map((): ResolvedModifierGroup | null => null));
  const relevant = lines.some(
    line => line.modifierGroups !== undefined || line.modifiers.some(row => row.catalogId)
  );
  if (!relevant) return resolved;
  const groupsByProduct = activeGroupsForProducts(db, scope, [
    ...new Set(lines.map(line => line.productId)),
  ]);
  const allGroupIds = [...new Set([...groupsByProduct.values()].flat().map(group => group.id))];
  const options = optionsByGroup(db, scope.tenantId, allGroupIds);
  for (const [lineIndex, line] of lines.entries()) {
    const groups = groupsByProduct.get(line.productId) ?? [];
    const byId = new Map(groups.map(group => [group.id, group]));
    if (line.modifierGroups) {
      const declared = new Map(line.modifierGroups.map(group => [group.id, group.version]));
      if (
        declared.size !== line.modifierGroups.length ||
        declared.size !== groups.length ||
        groups.some(group => declared.get(group.id) !== group.version)
      )
        changed();
    }
    const counts = new Map<string, number>();
    for (const [index, modifier] of line.modifiers.entries()) {
      let group = modifier.groupId ? byId.get(modifier.groupId) : undefined;
      if (modifier.groupId && !group) changed();
      if (!group && modifier.catalogId) {
        const owners = groups.filter(candidate =>
          (options.get(candidate.id) ?? []).some(row => row.catalogId === modifier.catalogId)
        );
        // An option listed by several groups of the dish stays ungrouped: there is no one rule.
        if (owners.length === 1) group = owners[0];
      }
      if (!group) continue;
      const option = (options.get(group.id) ?? []).find(
        row => row.catalogId === modifier.catalogId
      );
      if (!option?.isActive) changed();
      // A preparation is picked once and a removal has no quantity.
      if ((group.selection === 'single' || group.kind === 'without') && modifier.quantity !== 1)
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'RESTAURANT_MODIFIER_GROUP_SELECTION_INVALID',
          message: 'Choose one option once',
          details: { groupId: group.id },
        });
      counts.set(group.id, (counts.get(group.id) ?? 0) + 1);
      resolved[lineIndex]![index] = { id: group.id, kind: group.kind };
    }
    for (const group of groups) {
      const chosen = counts.get(group.id) ?? 0;
      const min = line.modifierGroups
        ? effectiveMinimum(group.minSelections, options.get(group.id) ?? [])
        : 0;
      if (chosen > group.maxSelections || chosen < min)
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'RESTAURANT_MODIFIER_GROUP_SELECTION_INVALID',
          message: 'The options chosen do not meet the group rule',
          details: { groupId: group.id, min, max: group.maxSelections, chosen },
        });
    }
  }
  return resolved;
}
