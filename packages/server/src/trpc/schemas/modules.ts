/**
 * ENG-068 — Zod input schemas for `modules.*` procedures.
 */

import { z } from 'zod';
import {
  MODULE_IDS,
  isModuleId,
  type ModuleId,
} from '../../services/modules/manifest.js';

/**
 * Module id input. Refines against the closed list from
 * `MODULE_IDS` so a stale client passing a removed module id fails
 * at validation rather than silently no-op.
 */
const moduleIdSchema: z.ZodType<ModuleId> = z
  .string()
  .min(1, 'moduleId is required')
  .refine(isModuleId, {
    message: `moduleId must be one of: ${MODULE_IDS.join(', ')}`,
  }) as unknown as z.ZodType<ModuleId>;

/**
 * Input for `modules.setActive`. The shape stays minimal — toggling
 * is the v1 surface. A bulk-set variant (multiple toggles in one
 * tx) lands in a follow-up if it's needed.
 */
export const setModuleActiveInput = z.object({
  moduleId: moduleIdSchema,
  enabled: z.boolean(),
});
export type SetModuleActiveInput = z.infer<typeof setModuleActiveInput>;
