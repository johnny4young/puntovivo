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

// ENG-067b — opt-in dedup key for `peripherals.printReceipt` /
// `kickCashDrawer`. Empty-string from a UI form normalizes to
// `undefined` at the boundary so callers don't have to special-case
// "user hasn't typed anything yet".
//
// Two `.optional()`s are required:
//   - INNER (`z.string().min(...).optional()`): so the preprocess
//     return value of `undefined` (when input was '') type-checks
//     against the inner schema.
//   - OUTER (`.optional()` after preprocess): so the field is
//     optional at the object level — without it, `z.preprocess` makes
//     the field required with type `unknown` and breaks every
//     existing call site that omits the key.
const hardwareIdempotencyKeySchema = z
  .preprocess(
    value => (value === '' ? undefined : value),
    z.string().min(1).max(128).optional()
  )
  .optional();

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
  /**
   * ENG-067b — opt-in dedup key. The web client may pass a stable
   * key per logical print attempt so a tRPC retry after a network
   * blip doesn't enqueue twice. When omitted, the legacy "two
   * clicks → two prints" path stays.
   */
  idempotencyKey: hardwareIdempotencyKeySchema,
});
export type PrintReceiptInput = z.infer<typeof printReceiptInput>;

// ENG-062 — manager-gated cash drawer kick. Idempotent on the
// hardware side (a stale retry just re-pulses the relay).
export const kickCashDrawerInput = z.object({
  siteId: z.string().min(1, 'siteId is required'),
  /** ENG-067b — opt-in dedup key (see printReceiptInput). */
  idempotencyKey: hardwareIdempotencyKeySchema,
});
export type KickCashDrawerInput = z.infer<typeof kickCashDrawerInput>;

// ENG-074b — read-only "give me the bytes" inputs for the
// hub_client local hardware bridge. Same shape as printReceipt /
// kickCashDrawer minus the idempotency key (these procedures
// never write `hardware_outbox` so dedup is moot). Per
// ADR-0008 rule 6 the bridge runs on the terminal that owns the
// physical printer; the server only resolves the active
// peripheral and serializes the bytes.
export const buildReceiptBytesInput = z.object({
  saleId: z.string().min(1, 'saleId is required'),
  siteId: z.string().min(1, 'siteId is required'),
});
export type BuildReceiptBytesInput = z.infer<typeof buildReceiptBytesInput>;

export const buildDrawerKickBytesInput = z.object({
  siteId: z.string().min(1, 'siteId is required'),
});
export type BuildDrawerKickBytesInput = z.infer<typeof buildDrawerKickBytesInput>;

// ENG-062 — operator-visible peek into the hardware outbox tail.
// Consumed by ENG-065a's Operations Center Device Health panel;
// tenant-scoped so cross-tenant rows never leak.
export const peekHardwareOutboxInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export type PeekHardwareOutboxInput = z.infer<typeof peekHardwareOutboxInput>;

// ENG-065a — admin path for "this hardware row got stuck on a
// transient error; force a retry now". Mirrors `sync.retry` and
// `reports.fiscal.retryDocument` shape.
export const retryHardwareOutboxInput = z.object({
  id: z.string().min(1, 'hardware_outbox row id is required'),
});
export type RetryHardwareOutboxInput = z.infer<typeof retryHardwareOutboxInput>;
