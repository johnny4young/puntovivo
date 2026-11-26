/** Input contracts for normalized restaurant service procedures. */
import { z } from 'zod';
import { RESTAURANT_REGROUP_MAX_ACCOUNTS } from '@puntovivo/shared/restaurant-split';
import { MAX_RESTAURANT_GROUPS_PER_PRODUCT } from './restaurantModifiers.js';
import { saleItemInput } from './sales.js';

const restaurantModifierInput = z
  .object({
    catalogId: z.string().trim().min(1).max(128).optional(),
    catalogVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    groupId: z.string().trim().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(80),
    quantity: z.number().int().min(1).max(20).default(1),
    unitPriceDelta: z.number().finite().min(0).max(1_000_000_000).default(0),
  })
  .strict()
  .refine(
    value => (value.catalogId === undefined) === (value.catalogVersion === undefined),
    'Catalog identity and version must be provided together'
  )
  .refine(
    value => value.groupId === undefined || value.catalogId !== undefined,
    'A group option must reference its catalog entry'
  );

const restaurantDinerInput = z
  .object({
    clientId: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80).nullable().optional(),
    seatNumber: z.number().int().min(1).max(200).nullable().optional(),
  })
  .strict();

const restaurantOrderItemInput = saleItemInput
  .extend({
    dinerClientId: z.string().trim().min(1).max(80).nullable().optional(),
    courseKey: z.enum(['starter', 'main', 'dessert', 'drink', 'other']).default('main'),
    /** Groups shown for the dish; sending them makes the group minimums binding. */
    modifierGroups: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(128),
            version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          })
          .strict()
      )
      .max(MAX_RESTAURANT_GROUPS_PER_PRODUCT)
      .optional(),
    modifiers: z
      .array(restaurantModifierInput)
      .max(20)
      .default([])
      .superRefine((modifiers, ctx) => {
        // Use locale-independent Unicode casing so the same payload validates
        // identically on macOS, Windows and Linux hosts.
        const normalized = modifiers.map(modifier => modifier.name.toLowerCase());
        if (new Set(normalized).size !== normalized.length) {
          ctx.addIssue({ code: 'custom', message: 'Modifier names must be unique per line' });
        }
      }),
  })
  .strict();

export const openRestaurantCheckInput = z
  .object({
    reservation: z
      .object({
        id: z.string().trim().min(1).max(128),
        expectedVersion: z
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER - 1),
      })
      .strict()
      .optional(),
    tableId: z.string().min(1),
    guestCount: z.number().int().min(1).max(200),
    priceTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    checkLabel: z.string().trim().min(1).max(80).nullable().optional(),
    roundLabel: z.string().trim().min(1).max(80).nullable().optional(),
    diners: z.array(restaurantDinerInput).max(200).default([]),
    items: z.array(restaurantOrderItemInput).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.diners.length > value.guestCount) {
      ctx.addIssue({
        code: 'custom',
        path: ['diners'],
        message: 'Diner count cannot exceed the guest count',
      });
    }
    const clientIds = value.diners.map(diner => diner.clientId);
    if (new Set(clientIds).size !== clientIds.length) {
      ctx.addIssue({ code: 'custom', path: ['diners'], message: 'Diner ids must be unique' });
    }
    const seatNumbers = value.diners
      .map(diner => diner.seatNumber)
      .filter((seat): seat is number => seat != null);
    if (new Set(seatNumbers).size !== seatNumbers.length) {
      ctx.addIssue({ code: 'custom', path: ['diners'], message: 'Seat numbers must be unique' });
    }
    if (seatNumbers.some(seat => seat > value.guestCount)) {
      ctx.addIssue({
        code: 'custom',
        path: ['diners'],
        message: 'Diner seats cannot exceed the guest count',
      });
    }
    const knownDiners = new Set(clientIds);
    for (const [index, item] of value.items.entries()) {
      if (item.dinerClientId && !knownDiners.has(item.dinerClientId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'dinerClientId'],
          message: 'Order line references an unknown diner',
        });
      }
    }
  });

export const getRestaurantTableStateInput = z
  .object({
    tableId: z.string().min(1),
  })
  .strict();

export const setRestaurantBillRequestedInput = z
  .object({
    tableId: z.string().min(1),
    requested: z.boolean(),
  })
  .strict();

/** Plates waiting on an ordering device; zero clears the caller's own marker. */
export const setRestaurantPendingRoundInput = z
  .object({
    tableId: z.string().min(1),
    itemCount: z.number().int().min(0).max(1000),
  })
  .strict();

/**
 * Target layout for the open checks of one table; a null `checkId` opens a new
 * check. `checks` is the caller's view of every open check with its version.
 */
export const regroupRestaurantChecksInput = z
  .object({
    tableId: z.string().min(1),
    checks: z
      .array(
        z
          .object({
            checkId: z.string().min(1),
            version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          })
          .strict()
      )
      .min(1)
      .max(RESTAURANT_REGROUP_MAX_ACCOUNTS),
    plan: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('byDiner') }).strict(),
      z
        .object({
          kind: z.literal('accounts'),
          accounts: z
            .array(
              z
                .object({
                  checkId: z.string().min(1).nullable(),
                  saleItemIds: z.array(z.string().min(1)).max(1000),
                })
                .strict()
            )
            .min(1)
            .max(RESTAURANT_REGROUP_MAX_ACCOUNTS),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.plan.kind !== 'accounts') return;
    const checkIds = value.plan.accounts.flatMap(account =>
      account.checkId === null ? [] : [account.checkId]
    );
    if (new Set(checkIds).size !== checkIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['plan', 'accounts'],
        message: 'A check can appear only once in the plan',
      });
    }
    for (const [index, account] of value.plan.accounts.entries()) {
      if (account.checkId === null && account.saleItemIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['plan', 'accounts', index, 'saleItemIds'],
          message: 'A new check needs at least one line',
        });
      }
    }
  });

/** Fully validated payload for atomically opening a sale-backed restaurant check. */
export type OpenRestaurantCheckProcedureInput = z.infer<typeof openRestaurantCheckInput>;

export const addRestaurantRoundInput = z
  .object({
    tableId: z.string().min(1),
    checkId: z.string().min(1),
    expectedCheckVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    roundLabel: z.string().trim().min(1).max(80).nullable().optional(),
    diners: z.array(restaurantDinerInput).max(200).default([]),
    items: z.array(restaurantOrderItemInput).min(1).max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const clientIds = value.diners.map(diner => diner.clientId);
    if (new Set(clientIds).size !== clientIds.length) {
      ctx.addIssue({ code: 'custom', path: ['diners'], message: 'Diner ids must be unique' });
    }
    const knownDiners = new Set(clientIds);
    for (const [index, item] of value.items.entries()) {
      if (item.dinerClientId && !knownDiners.has(item.dinerClientId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'dinerClientId'],
          message: 'Order line references an unknown diner',
        });
      }
    }
  });

export const getRestaurantPrecheckInput = z
  .object({
    tableId: z.string().min(1),
    checkId: z.string().min(1).optional(),
    tipPercent: z.number().finite().min(0).max(100).default(10),
  })
  .strict();

export const printRestaurantPrecheckInput = z
  .object({
    tableId: z.string().min(1),
    checkId: z.string().min(1).optional(),
    tipPercent: z.number().finite().min(0).max(100).default(10),
    markBillRequested: z.boolean().default(true),
  })
  .strict();

export const splitRestaurantCheckEqualInput = z
  .object({
    tableId: z.string().min(1),
    checkId: z.string().min(1),
    expectedCheckVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    parts: z.number().int().min(2).max(RESTAURANT_REGROUP_MAX_ACCOUNTS),
  })
  .strict();

export const splitRestaurantSharedLineInput = z
  .object({
    tableId: z.string().min(1),
    checks: z
      .array(
        z
          .object({
            checkId: z.string().min(1),
            version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
          })
          .strict()
      )
      .min(1)
      .max(RESTAURANT_REGROUP_MAX_ACCOUNTS),
    saleItemId: z.string().min(1),
    targetCheckIds: z.array(z.string().min(1).nullable()).min(2).max(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    const nonNull = value.targetCheckIds.filter((id): id is string => id !== null);
    if (new Set(nonNull).size !== nonNull.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetCheckIds'],
        message: 'A check can only receive one share of the same dish',
      });
    }
  });
