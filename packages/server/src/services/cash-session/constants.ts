/**
 * Cash-session constants + the movement-type classification (leaf).
 *
 * The epsilon tolerance, register defaults, the default denomination
 * ladder, and the inflow/outflow movement-type Sets that the sign
 * convention reads. Kept in a leaf so denominations / movements /
 * registers share one source without a cycle.
 *
 * @module services/cash-session/constants
 */

import { cashMovementTypeEnum } from '../../db/schema.js';

export const CASH_SESSION_EPSILON = 1e-6;
export const DEFAULT_REGISTER_NAME = 'Main register';
export const REGISTER_ASSIGNMENT_BACKFILL_LIMIT = 100;
export const DEFAULT_CASH_SESSION_DENOMINATION_VALUES = [
  100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50,
] as const;
export const CASH_MOVEMENT_POSITIVE_TYPES = new Set<(typeof cashMovementTypeEnum)[number]>([
  'sale',
  'paid_in',
  'replenishment',
]);
export const CASH_MOVEMENT_NEGATIVE_TYPES = new Set<(typeof cashMovementTypeEnum)[number]>([
  'refund',
  'paid_out',
  'skim',
]);

export type CashMovementType = (typeof cashMovementTypeEnum)[number];
