/**
 * Saved transformation recipes and immutable inventory executions.
 *
 * Recipes describe expected base-unit inputs/outputs. Executions freeze the
 * actual quantities, exact lot identities, waste evidence, and distributed
 * cost used by hardware cuts, butchery yields, and prepared-product recipes.
 *
 * @module db/schema/inventory/transformations
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { lotStatusEnum, moneyPositiveChecks, nowIso, sqliteNow, syncStatusEnum } from '../base.js';
import { sites, tenants, users } from '../auth.js';
import { products } from '../products.js';
import { inventoryLots } from './lots.js';

export const inventoryTransformationKindEnum = [
  'assembly',
  'disassembly',
  'cut',
  'recipe',
] as const;
export type InventoryTransformationKind = (typeof inventoryTransformationKindEnum)[number];

export const inventoryTransformationOutputRoleEnum = ['primary', 'byproduct', 'remnant'] as const;
export type InventoryTransformationOutputRole =
  (typeof inventoryTransformationOutputRoleEnum)[number];

export const inventoryTransformationStatusEnum = ['completed', 'voided'] as const;
export type InventoryTransformationStatus = (typeof inventoryTransformationStatusEnum)[number];

export const inventoryTransformationRecipes = sqliteTable(
  'inventory_transformation_recipes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Null means the recipe is available at every site in the tenant. */
    siteId: text('site_id').references(() => sites.id),
    name: text('name').notNull(),
    kind: text('kind', { enum: inventoryTransformationKindEnum }).notNull(),
    notes: text('notes'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    version: integer('version').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_transformation_recipes_tenant').on(table.tenantId),
    index('idx_inventory_transformation_recipes_site').on(table.siteId),
    uniqueIndex('idx_inventory_transformation_recipes_global_name')
      .on(table.tenantId, table.name)
      .where(sql`${table.siteId} IS NULL`),
    uniqueIndex('idx_inventory_transformation_recipes_site_name')
      .on(table.tenantId, table.siteId, table.name)
      .where(sql`${table.siteId} IS NOT NULL`),
  ]
);

export const inventoryTransformationRecipeInputs = sqliteTable(
  'inventory_transformation_recipe_inputs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => inventoryTransformationRecipes.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    baseQuantity: real('base_quantity').notNull(),
    position: integer('position').notNull(),
  },
  table => [
    index('idx_inventory_transformation_recipe_inputs_tenant').on(table.tenantId),
    index('idx_inventory_transformation_recipe_inputs_recipe').on(table.recipeId),
    index('idx_inventory_transformation_recipe_inputs_product').on(table.productId),
    uniqueIndex('idx_inventory_transformation_recipe_inputs_position').on(
      table.recipeId,
      table.position
    ),
    uniqueIndex('idx_inventory_transformation_recipe_inputs_recipe_product').on(
      table.recipeId,
      table.productId
    ),
    check(
      'chk_inventory_transformation_recipe_inputs_quantity_positive',
      sql`${table.baseQuantity} > 0`
    ),
  ]
);

export const inventoryTransformationRecipeOutputs = sqliteTable(
  'inventory_transformation_recipe_outputs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => inventoryTransformationRecipes.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    expectedBaseQuantity: real('expected_base_quantity').notNull(),
    allocationWeight: real('allocation_weight').notNull(),
    role: text('role', { enum: inventoryTransformationOutputRoleEnum }).notNull(),
    position: integer('position').notNull(),
  },
  table => [
    index('idx_inventory_transformation_recipe_outputs_tenant').on(table.tenantId),
    index('idx_inventory_transformation_recipe_outputs_recipe').on(table.recipeId),
    index('idx_inventory_transformation_recipe_outputs_product').on(table.productId),
    uniqueIndex('idx_inventory_transformation_recipe_outputs_position').on(
      table.recipeId,
      table.position
    ),
    uniqueIndex('idx_inventory_transformation_recipe_outputs_recipe_product').on(
      table.recipeId,
      table.productId
    ),
    check(
      'chk_inventory_transformation_recipe_outputs_quantity_positive',
      sql`${table.expectedBaseQuantity} > 0`
    ),
    check(
      'chk_inventory_transformation_recipe_outputs_weight_positive',
      sql`${table.allocationWeight} > 0`
    ),
  ]
);

export const inventoryTransformations = sqliteTable(
  'inventory_transformations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    recipeId: text('recipe_id').references(() => inventoryTransformationRecipes.id),
    recipeNameSnapshot: text('recipe_name_snapshot').notNull(),
    kindSnapshot: text('kind_snapshot', { enum: inventoryTransformationKindEnum }).notNull(),
    status: text('status', { enum: inventoryTransformationStatusEnum })
      .notNull()
      .default('completed'),
    totalInputCost: real('total_input_cost').notNull(),
    totalOutputCost: real('total_output_cost').notNull(),
    notes: text('notes'),
    executedBy: text('executed_by')
      .notNull()
      .references(() => users.id),
    voidedBy: text('voided_by').references(() => users.id),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason'),
    syncStatus: text('sync_status', { enum: syncStatusEnum }).default('pending'),
    syncVersion: integer('sync_version').default(0),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_transformations_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_inventory_transformations_site_created').on(table.siteId, table.createdAt),
    index('idx_inventory_transformations_recipe').on(table.recipeId),
    check(
      'chk_inventory_transformations_cost_conservation',
      sql`${table.totalInputCost} = ${table.totalOutputCost}`
    ),
    check(
      'chk_inventory_transformations_void_state',
      sql`(${table.status} = 'completed' AND ${table.voidedBy} IS NULL AND ${table.voidedAt} IS NULL AND ${table.voidReason} IS NULL) OR (${table.status} = 'voided' AND ${table.voidedBy} IS NOT NULL AND ${table.voidedAt} IS NOT NULL AND ${table.voidReason} IS NOT NULL)`
    ),
    ...moneyPositiveChecks('inventory_transformations_input_cost', table.totalInputCost),
    ...moneyPositiveChecks('inventory_transformations_output_cost', table.totalOutputCost),
  ]
);

export const inventoryTransformationInputs = sqliteTable(
  'inventory_transformation_inputs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transformationId: text('transformation_id')
      .notNull()
      .references(() => inventoryTransformations.id, { onDelete: 'cascade' }),
    recipeInputId: text('recipe_input_id').references(
      () => inventoryTransformationRecipeInputs.id,
      {
        onDelete: 'set null',
      }
    ),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    lotId: text('lot_id').references(() => inventoryLots.id),
    lotNumberSnapshot: text('lot_number_snapshot'),
    expiresAtSnapshot: text('expires_at_snapshot'),
    sourceStatusSnapshot: text('source_status_snapshot', { enum: lotStatusEnum }),
    baseQuantity: real('base_quantity').notNull(),
    unitCost: real('unit_cost').notNull(),
    totalCost: real('total_cost').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_transformation_inputs_tenant').on(table.tenantId),
    index('idx_inventory_transformation_inputs_transformation').on(table.transformationId),
    index('idx_inventory_transformation_inputs_product').on(table.productId),
    index('idx_inventory_transformation_inputs_lot').on(table.lotId),
    check(
      'chk_inventory_transformation_inputs_lot_snapshot',
      sql`(${table.lotId} IS NULL AND ${table.lotNumberSnapshot} IS NULL AND ${table.expiresAtSnapshot} IS NULL AND ${table.sourceStatusSnapshot} IS NULL) OR (${table.lotId} IS NOT NULL AND ${table.lotNumberSnapshot} IS NOT NULL AND ${table.sourceStatusSnapshot} IS NOT NULL)`
    ),
    check('chk_inventory_transformation_inputs_quantity_positive', sql`${table.baseQuantity} > 0`),
    ...moneyPositiveChecks('inventory_transformation_inputs_unit_cost', table.unitCost),
    ...moneyPositiveChecks('inventory_transformation_inputs_total_cost', table.totalCost),
  ]
);

export const inventoryTransformationOutputs = sqliteTable(
  'inventory_transformation_outputs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transformationId: text('transformation_id')
      .notNull()
      .references(() => inventoryTransformations.id, { onDelete: 'cascade' }),
    recipeOutputId: text('recipe_output_id').references(
      () => inventoryTransformationRecipeOutputs.id,
      { onDelete: 'set null' }
    ),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    lotId: text('lot_id').references(() => inventoryLots.id),
    lotNumberSnapshot: text('lot_number_snapshot'),
    expiresAtSnapshot: text('expires_at_snapshot'),
    role: text('role', { enum: inventoryTransformationOutputRoleEnum }).notNull(),
    baseQuantity: real('base_quantity').notNull(),
    allocationWeight: real('allocation_weight').notNull(),
    allocatedCost: real('allocated_cost').notNull(),
    unitCost: real('unit_cost').notNull(),
    previousProductCost: real('previous_product_cost').notNull(),
    /** Inventory-valuation cost visible immediately before this output was posted. */
    previousProductInitialCost: real('previous_product_initial_cost').notNull(),
    /** Cost visible on the product immediately after this output was posted. */
    resultingProductCost: real('resulting_product_cost').notNull(),
    /** Inventory-valuation cost visible immediately after this output was posted. */
    resultingProductInitialCost: real('resulting_product_initial_cost').notNull(),
    /** Product revision immediately after the output cost was posted. */
    resultingProductSyncVersion: integer('resulting_product_sync_version').notNull(),
    /** Site-balance revision immediately after the output credit. */
    resultingBalanceVersion: integer('resulting_balance_version').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_transformation_outputs_tenant').on(table.tenantId),
    index('idx_inventory_transformation_outputs_transformation').on(table.transformationId),
    index('idx_inventory_transformation_outputs_product').on(table.productId),
    index('idx_inventory_transformation_outputs_lot').on(table.lotId),
    check(
      'chk_inventory_transformation_outputs_lot_snapshot',
      sql`(${table.lotId} IS NULL AND ${table.lotNumberSnapshot} IS NULL AND ${table.expiresAtSnapshot} IS NULL) OR (${table.lotId} IS NOT NULL AND ${table.lotNumberSnapshot} IS NOT NULL)`
    ),
    check('chk_inventory_transformation_outputs_quantity_positive', sql`${table.baseQuantity} > 0`),
    check(
      'chk_inventory_transformation_outputs_weight_positive',
      sql`${table.allocationWeight} > 0`
    ),
    ...moneyPositiveChecks('inventory_transformation_outputs_allocated_cost', table.allocatedCost),
    ...moneyPositiveChecks('inventory_transformation_outputs_unit_cost', table.unitCost),
    ...moneyPositiveChecks(
      'inventory_transformation_outputs_previous_cost',
      table.previousProductCost
    ),
    ...moneyPositiveChecks(
      'inventory_transformation_outputs_previous_initial_cost',
      table.previousProductInitialCost
    ),
    ...moneyPositiveChecks(
      'inventory_transformation_outputs_resulting_cost',
      table.resultingProductCost
    ),
    ...moneyPositiveChecks(
      'inventory_transformation_outputs_resulting_initial_cost',
      table.resultingProductInitialCost
    ),
    check(
      'chk_inventory_transformation_outputs_product_version_nonnegative',
      sql`${table.resultingProductSyncVersion} >= 0`
    ),
    check(
      'chk_inventory_transformation_outputs_balance_version_nonnegative',
      sql`${table.resultingBalanceVersion} >= 0`
    ),
  ]
);

/** Waste is evidence about already-consumed input; it never applies a second stock delta. */
export const inventoryTransformationWaste = sqliteTable(
  'inventory_transformation_waste',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    transformationId: text('transformation_id')
      .notNull()
      .references(() => inventoryTransformations.id, { onDelete: 'cascade' }),
    transformationInputId: text('transformation_input_id')
      .notNull()
      .references(() => inventoryTransformationInputs.id, { onDelete: 'cascade' }),
    baseQuantity: real('base_quantity').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_inventory_transformation_waste_tenant').on(table.tenantId),
    index('idx_inventory_transformation_waste_transformation').on(table.transformationId),
    index('idx_inventory_transformation_waste_input').on(table.transformationInputId),
    check('chk_inventory_transformation_waste_quantity_positive', sql`${table.baseQuantity} > 0`),
  ]
);

export const inventoryTransformationRecipesRelations = relations(
  inventoryTransformationRecipes,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [inventoryTransformationRecipes.tenantId],
      references: [tenants.id],
    }),
    site: one(sites, {
      fields: [inventoryTransformationRecipes.siteId],
      references: [sites.id],
    }),
    createdByUser: one(users, {
      fields: [inventoryTransformationRecipes.createdBy],
      references: [users.id],
    }),
    inputs: many(inventoryTransformationRecipeInputs),
    outputs: many(inventoryTransformationRecipeOutputs),
    executions: many(inventoryTransformations),
  })
);

export const inventoryTransformationRecipeInputsRelations = relations(
  inventoryTransformationRecipeInputs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [inventoryTransformationRecipeInputs.tenantId],
      references: [tenants.id],
    }),
    recipe: one(inventoryTransformationRecipes, {
      fields: [inventoryTransformationRecipeInputs.recipeId],
      references: [inventoryTransformationRecipes.id],
    }),
    product: one(products, {
      fields: [inventoryTransformationRecipeInputs.productId],
      references: [products.id],
    }),
  })
);

export const inventoryTransformationRecipeOutputsRelations = relations(
  inventoryTransformationRecipeOutputs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [inventoryTransformationRecipeOutputs.tenantId],
      references: [tenants.id],
    }),
    recipe: one(inventoryTransformationRecipes, {
      fields: [inventoryTransformationRecipeOutputs.recipeId],
      references: [inventoryTransformationRecipes.id],
    }),
    product: one(products, {
      fields: [inventoryTransformationRecipeOutputs.productId],
      references: [products.id],
    }),
  })
);

export const inventoryTransformationsRelations = relations(
  inventoryTransformations,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [inventoryTransformations.tenantId],
      references: [tenants.id],
    }),
    site: one(sites, {
      fields: [inventoryTransformations.siteId],
      references: [sites.id],
    }),
    recipe: one(inventoryTransformationRecipes, {
      fields: [inventoryTransformations.recipeId],
      references: [inventoryTransformationRecipes.id],
    }),
    executedByUser: one(users, {
      fields: [inventoryTransformations.executedBy],
      references: [users.id],
      relationName: 'inventoryTransformationExecutedBy',
    }),
    voidedByUser: one(users, {
      fields: [inventoryTransformations.voidedBy],
      references: [users.id],
      relationName: 'inventoryTransformationVoidedBy',
    }),
    inputs: many(inventoryTransformationInputs),
    outputs: many(inventoryTransformationOutputs),
    waste: many(inventoryTransformationWaste),
  })
);

export const inventoryTransformationInputsRelations = relations(
  inventoryTransformationInputs,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [inventoryTransformationInputs.tenantId],
      references: [tenants.id],
    }),
    transformation: one(inventoryTransformations, {
      fields: [inventoryTransformationInputs.transformationId],
      references: [inventoryTransformations.id],
    }),
    recipeInput: one(inventoryTransformationRecipeInputs, {
      fields: [inventoryTransformationInputs.recipeInputId],
      references: [inventoryTransformationRecipeInputs.id],
    }),
    product: one(products, {
      fields: [inventoryTransformationInputs.productId],
      references: [products.id],
    }),
    lot: one(inventoryLots, {
      fields: [inventoryTransformationInputs.lotId],
      references: [inventoryLots.id],
    }),
    waste: many(inventoryTransformationWaste),
  })
);

export const inventoryTransformationOutputsRelations = relations(
  inventoryTransformationOutputs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [inventoryTransformationOutputs.tenantId],
      references: [tenants.id],
    }),
    transformation: one(inventoryTransformations, {
      fields: [inventoryTransformationOutputs.transformationId],
      references: [inventoryTransformations.id],
    }),
    recipeOutput: one(inventoryTransformationRecipeOutputs, {
      fields: [inventoryTransformationOutputs.recipeOutputId],
      references: [inventoryTransformationRecipeOutputs.id],
    }),
    product: one(products, {
      fields: [inventoryTransformationOutputs.productId],
      references: [products.id],
    }),
    lot: one(inventoryLots, {
      fields: [inventoryTransformationOutputs.lotId],
      references: [inventoryLots.id],
    }),
  })
);

export const inventoryTransformationWasteRelations = relations(
  inventoryTransformationWaste,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [inventoryTransformationWaste.tenantId],
      references: [tenants.id],
    }),
    transformation: one(inventoryTransformations, {
      fields: [inventoryTransformationWaste.transformationId],
      references: [inventoryTransformations.id],
    }),
    input: one(inventoryTransformationInputs, {
      fields: [inventoryTransformationWaste.transformationInputId],
      references: [inventoryTransformationInputs.id],
    }),
  })
);
