/**
 * ENG-173 — Schemas for the `observability.*` router (Web Vitals RUM).
 *
 * @module trpc/schemas/observability
 */

import { z } from 'zod';
import {
  webVitalDeviceClassEnum,
  webVitalMetricEnum,
  webVitalRatingEnum,
} from '../../db/schema.js';

/**
 * Input for the public `observability.reportWebVital` mutation.
 *
 * The client sends ONLY the measured fields — `tenantId` and `tenantPlan`
 * are derived server-side from the session, never trusted from the client
 * (a public, unauthenticated mutation must not accept a client-supplied
 * tenant). The bounds harden the unauthenticated write surface:
 * - `value` — CLS is a small unitless float; the timing metrics are
 *   milliseconds. `1e7` ms (~2.7 h) is a generous ceiling that still rejects
 *   absurd / abusive payloads. `min(0)` because no Web Vital is negative.
 * - `route` — capped at 256 chars so a caller can't store unbounded strings.
 */
export const reportWebVitalInput = z.object({
  metric: z.enum(webVitalMetricEnum),
  value: z.number().finite().min(0).max(1e7),
  rating: z.enum(webVitalRatingEnum),
  route: z.string().min(1).max(256),
  deviceClass: z.enum(webVitalDeviceClassEnum),
}).strict();

/** Validated payload of a single Web Vitals sample sent by the browser. */
export type ReportWebVitalInput = z.infer<typeof reportWebVitalInput>;

/**
 * Input for the admin `observability.recentWebVitals` read — a single
 * optional `limit` clamped to a sane window (mirrors `events.peekOutbox`).
 */
export const recentWebVitalsInput = z.object({
  limit: z.number().int().positive().max(200).default(50),
}).strict();

/** Validated input for the tenant-scoped recent-samples read. */
export type RecentWebVitalsInput = z.infer<typeof recentWebVitalsInput>;
