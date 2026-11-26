/** Bounded, site-local catalog commands. A zero expected version creates; edits never move a site. */
import { z } from 'zod';
import {
  restaurantModifierGroupKindEnum,
  restaurantModifierGroupSelectionEnum,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';

export const MAX_ACTIVE_RESTAURANT_MODIFIERS = 500;
const siteId = z.string().trim().min(1).max(128);
export const listRestaurantModifiersInput = z
  .object({
    siteId,
    includeArchived: z.boolean().default(false),
    search: z.string().trim().max(80).default(''),
    limit: z.number().int().min(1).max(50).default(25),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

export const saveRestaurantModifierInput = z
  .object({
    siteId,
    id: z.string().trim().min(1).max(128).optional(),
    expectedVersion: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    name: z.string().trim().min(1).max(80),
    unitPriceDelta: z
      .number()
      .finite()
      .min(0)
      .max(1_000_000_000)
      .refine(value => value === roundMoney(value), 'Use at most two decimal places'),
    maxQuantity: z.number().int().min(1).max(20),
    requiresManager: z.boolean(),
    isActive: z.boolean(),
  })
  .strict()
  .refine(
    value => (value.id ? value.expectedVersion > 0 : value.expectedVersion === 0),
    'An existing row requires its exact positive version'
  );

/** Fully parsed catalog command; no implicit field clearing or blind upsert. */
export type SaveRestaurantModifierInput = z.infer<typeof saveRestaurantModifierInput>;

export const MAX_ACTIVE_RESTAURANT_MODIFIER_GROUPS = 100;
/** Matches the per-line modifier bound, so every option of a group fits on one plate. */
export const MAX_RESTAURANT_GROUP_OPTIONS = 20;
export const MAX_RESTAURANT_GROUP_PRODUCTS = 500;
export const MAX_RESTAURANT_GROUPS_PER_PRODUCT = 8;
const rowId = z.string().trim().min(1).max(128);

export const listRestaurantModifierGroupsInput = z
  .object({ siteId, includeArchived: z.boolean().default(false) })
  .strict();

export const restaurantProductModifierGroupsInput = z.object({ siteId, productId: rowId }).strict();

export const saveRestaurantModifierGroupInput = z
  .object({
    siteId,
    id: rowId.optional(),
    expectedVersion: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(restaurantModifierGroupKindEnum),
    selection: z.enum(restaurantModifierGroupSelectionEnum),
    minSelections: z.number().int().min(0).max(MAX_RESTAURANT_GROUP_OPTIONS),
    maxSelections: z.number().int().min(1).max(MAX_RESTAURANT_GROUP_OPTIONS),
    isActive: z.boolean(),
    /** Ordered as the plate sheet shows them. */
    catalogIds: z.array(rowId).min(1).max(MAX_RESTAURANT_GROUP_OPTIONS),
    productIds: z.array(rowId).max(MAX_RESTAURANT_GROUP_PRODUCTS),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.id ? value.expectedVersion <= 0 : value.expectedVersion !== 0)
      ctx.addIssue({
        code: 'custom',
        message: 'An existing row requires its exact positive version',
      });
    if (value.selection === 'single' && value.maxSelections !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['maxSelections'],
        message: 'Single choice allows one',
      });
    if (value.minSelections > value.maxSelections)
      ctx.addIssue({ code: 'custom', path: ['minSelections'], message: 'Minimum exceeds maximum' });
    if (value.maxSelections > value.catalogIds.length)
      ctx.addIssue({ code: 'custom', path: ['maxSelections'], message: 'Maximum exceeds options' });
    if (new Set(value.catalogIds).size !== value.catalogIds.length)
      ctx.addIssue({ code: 'custom', path: ['catalogIds'], message: 'Options must be unique' });
    if (new Set(value.productIds).size !== value.productIds.length)
      ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'Products must be unique' });
  });

/** Fully parsed group command; options and dishes are replaced as a whole. */
export type SaveRestaurantModifierGroupInput = z.infer<typeof saveRestaurantModifierGroupInput>;

export const getRestaurantModifierBomInput = z
  .object({
    siteId,
    catalogId: rowId,
  })
  .strict();

export const setRestaurantModifierBomInput = z
  .object({
    siteId,
    catalogId: rowId,
    components: z
      .array(
        z
          .object({
            componentProductId: rowId,
            quantity: z.number().finite().positive().max(1_000_000),
          })
          .strict()
      )
      .max(50),
  })
  .strict();
