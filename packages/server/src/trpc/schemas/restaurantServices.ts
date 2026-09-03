/** Input contracts for normalized restaurant service procedures. */
import { z } from 'zod';
import { saleItemInput } from './sales.js';

const restaurantModifierInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    quantity: z.number().int().min(1).max(20).default(1),
    unitPriceDelta: z.number().finite().min(0).max(1_000_000_000).default(0),
  })
  .strict();

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

/** Fully validated payload for atomically opening a sale-backed restaurant check. */
export type OpenRestaurantCheckProcedureInput = z.infer<typeof openRestaurantCheckInput>;
