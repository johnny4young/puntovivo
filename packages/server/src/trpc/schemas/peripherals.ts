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

// ENG-061 — sales-role read of the active peripherals for a site.
// Returns a minimal projection (kind + driver + config) so the
// SalesPage can drive the wedge listener; admin `peripherals.list`
// stays the canonical full-row read for the admin UI.
export const activeForSiteInput = z.object({
  siteId: z.string().min(1, 'siteId is required'),
});
export type ActiveForSiteInput = z.infer<typeof activeForSiteInput>;

// ENG-062 — receipt print orchestrator. Takes a sale id + the
// active site so the server can dispatch to the right printer. The
// server resolves the sale (cross-tenant guard) and the active
// printer peripheral, then either confirms the bytes flushed or
// signals fallback so the renderer prints via the legacy system
// path. Tenant-scoped so any authenticated cashier can fire after
// a sale.
export const printReceiptInput = z.object({
  saleId: z.string().min(1, 'saleId is required'),
  siteId: z.string().min(1, 'siteId is required'),
});
export type PrintReceiptInput = z.infer<typeof printReceiptInput>;

// ENG-062 — manager-gated cash drawer kick. Idempotent on the
// hardware side (a stale retry just re-pulses the relay).
export const kickCashDrawerInput = z.object({
  siteId: z.string().min(1, 'siteId is required'),
});
export type KickCashDrawerInput = z.infer<typeof kickCashDrawerInput>;

// ENG-062 — operator-visible peek into the hardware outbox tail.
// Stub for ENG-065's Operations Center to consume; tenant-scoped
// so cross-tenant rows never leak.
export const peekHardwareOutboxInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export type PeekHardwareOutboxInput = z.infer<typeof peekHardwareOutboxInput>;
