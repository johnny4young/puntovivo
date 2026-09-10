/** Bounded, site-local catalog commands. A zero expected version creates; edits never move a site. */
import { z } from 'zod';
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
