/** Site-local kitchen configuration. Zero means create, never blind overwrite. */
import { z } from 'zod';

export const kitchenSiteInput = z.object({ siteId: z.string().min(1).max(128) });
export const saveKitchenStationInput = kitchenSiteInput.extend({
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean(),
  position: z.number().int().min(0).max(999),
  expectedVersion: z.number().int().nonnegative(),
});
export const kitchenTargetInput = kitchenSiteInput.extend({
  targetKind: z.enum(['product', 'category']),
  targetId: z.string().min(1).max(128),
  expectedRuleId: z.string().min(1).max(128).nullable(),
  expectedVersion: z.number().int().nonnegative(),
});
export const saveKitchenRouteInput = kitchenTargetInput
  .extend({
    stationId: z.string().min(1).max(128).nullable(),
    route: z.enum(['station', 'exclude']),
  })
  .refine(input => (input.route === 'station') === (input.stationId !== null));
export const listKitchenTargetsInput = kitchenSiteInput.extend({
  targetKind: z.enum(['product', 'category']),
  search: z.string().trim().max(120).default(''),
  configuredOnly: z.boolean().default(false),
  cursor: z.string().min(1).max(128).optional(),
  limit: z.number().int().min(1).max(50).default(25),
});
/** Versions describe the config row, not any already-submitted preparation. */
export type SaveKitchenStationInput = z.infer<typeof saveKitchenStationInput>;
/** Null station is permitted only for an explicit exclusion. */
export type SaveKitchenRouteInput = z.infer<typeof saveKitchenRouteInput>;
/** Removing a rule explicitly restores inherited category/main routing. */
export type KitchenTargetInput = z.infer<typeof kitchenTargetInput>;
