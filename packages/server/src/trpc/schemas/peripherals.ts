/**
 * ENG-060 — Zod input schemas for `peripherals.*` admin procedures.
 *
 * Driver-specific config validation lives with the driver class (per
 * `services/peripherals/registry.ts::validatePeripheralConfig`); the
 * schemas here only enforce the structural shape: kind ∈ enum,
 * driver is a non-empty trimmed string, config is a JSON object.
 *
 * @module trpc/schemas/peripherals
 */

import { z } from 'zod';
import { peripheralKindEnum } from '../../db/schema.js';

const peripheralKindSchema = z.enum(peripheralKindEnum);

const driverIdSchema = z
  .string()
  .trim()
  .min(1, 'Driver id is required')
  .max(64, 'Driver id must be 64 characters or fewer');

const configSchema = z.record(z.string(), z.unknown()).default({});

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name cannot be empty')
  .max(120, 'Display name must be 120 characters or fewer');

export const listPeripheralsInput = z.object({
  siteId: z.string().min(1, 'siteId is required'),
});
export type ListPeripheralsInput = z.infer<typeof listPeripheralsInput>;

export const registerPeripheralInput = z.object({
  siteId: z.string().min(1),
  kind: peripheralKindSchema,
  driver: driverIdSchema,
  config: configSchema,
  displayName: displayNameSchema.nullish(),
});
export type RegisterPeripheralInput = z.infer<typeof registerPeripheralInput>;

export const updatePeripheralInput = z.object({
  id: z.string().min(1),
  driver: driverIdSchema.optional(),
  config: configSchema.optional(),
  displayName: displayNameSchema.nullish(),
});
export type UpdatePeripheralInput = z.infer<typeof updatePeripheralInput>;

export const setPeripheralActiveInput = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
export type SetPeripheralActiveInput = z.infer<typeof setPeripheralActiveInput>;

export const testPeripheralInput = z.object({
  id: z.string().min(1),
});
export type TestPeripheralInput = z.infer<typeof testPeripheralInput>;

export const removePeripheralInput = z.object({
  id: z.string().min(1),
});
export type RemovePeripheralInput = z.infer<typeof removePeripheralInput>;
