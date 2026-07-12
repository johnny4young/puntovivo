/**
 * ENG-104 — Setup readiness Zod schemas.
 *
 * Output shape consumed by `setupReadiness.get` and rendered by the
 * `CompanyReadinessCard` + `GlobalStatusStrip`. The section ids are a
 * closed enum so the renderer's i18n key registry stays in lockstep
 * with the server — adding a new section means widening BOTH the
 * server union AND `apps/web/src/i18n/locales/{en,es}/setup.json`.
 *
 * @module trpc/schemas/setupReadiness
 */

import { z } from 'zod';

/**
 * Closed union of readiness sections the aggregator inspects. Each id
 * is also an i18n key suffix under `setup.readiness.sections.<id>`.
 */
export const setupReadinessSectionIdEnum = [
  'locale',
  'sites',
  'fiscal',
  'peripherals',
  'payments',
  'modules',
  'users',
  'ai',
  'catalog',
  'cashSession',
  // ENG-184 — sync-outbox backlog reminder (local-first: never a
  // blocker, surfaced as a warning when replication is behind).
  'sync',
] as const;
export type SetupReadinessSectionId = (typeof setupReadinessSectionIdEnum)[number];

/**
 * - `ready`: the underlying signal is configured and operational.
 * - `blocker`: the operator cannot run the day without this (e.g.
 *   no products in catalog, no sites). Counted by `blockerCount`.
 * - `optional-pending`: nice-to-have but not blocking the daily flow
 *   (e.g. zero peripherals registered, only manual payment rails).
 *   Counted at half-weight by the score.
 * - `warning` (ENG-184): configured-but-degraded, or an optional-yet-
 *   recommended signal that needs attention (e.g. DIAN turned on but
 *   incomplete, fiscal documents failing transmission, sync backlog).
 *   A reminder — NEVER blocks selling. Counted at half-weight by the
 *   score, like `optional-pending`.
 * - `not-applicable`: the tenant opted out of the feature (e.g. AI
 *   master toggle off, fiscal disabled for non-Colombian tenant) and
 *   the section is excluded from the score denominator.
 */
export const setupReadinessStatusEnum = [
  'ready',
  'blocker',
  'optional-pending',
  'warning',
  'not-applicable',
] as const;
export type SetupReadinessStatus = (typeof setupReadinessStatusEnum)[number];

export const setupReadinessSectionSchema = z.object({
  id: z.enum(setupReadinessSectionIdEnum),
  status: z.enum(setupReadinessStatusEnum),
  /**
   * Per-section CTA destination. `null` when the section is
   * `not-applicable` (nothing to do) — the renderer hides the
   * button. Routes are absolute web paths; the optional `tab` is
   * the query-string key that maps to the right Company tab.
   */
  cta: z
    .object({
      route: z.string(),
      tab: z.string().optional(),
    })
    .nullable(),
});

export type SetupReadinessSection = z.infer<typeof setupReadinessSectionSchema>;

export const setupReadinessOutputSchema = z.object({
  /** 0-100 integer. Excludes not-applicable sections from denominator. */
  score: z.number().int().min(0).max(100),
  blockerCount: z.number().int().nonnegative(),
  sections: z.array(setupReadinessSectionSchema),
  /**
   * ISO timestamp when the admin called `companies.acknowledgeSetup`
   * to opt out of the force-redirect. Null = never acknowledged
   * (default for fresh tenants).
   */
  acknowledgedAt: z.string().nullable(),
});

export type SetupReadinessOutput = z.infer<typeof setupReadinessOutputSchema>;

/**
 * ENG-184 — Checkout readiness items surfaced to the cashier at the
 * point of sale via `setupReadiness.checkout`. Closed id union; each id
 * is an i18n key suffix under `sales.preflight.items.<id>`.
 */
export const checkoutReadinessItemIdEnum = [
  'fiscal',
  'receipt_hardware',
  'payment_rail',
  'sync',
] as const;
export type CheckoutReadinessItemId = (typeof checkoutReadinessItemIdEnum)[number];

/**
 * Severity of a checkout readiness item. Under the ENG-184 local-first
 * model EVERY checkout readiness item is a `warning` (a reminder that
 * leaves the charge button enabled); `blocker` stays in the union for
 * future use + parity with the client preflight severity contract, but
 * nothing in the checkout query emits it today.
 */
export const checkoutReadinessSeverityEnum = ['blocker', 'warning'] as const;
export type CheckoutReadinessSeverity =
  (typeof checkoutReadinessSeverityEnum)[number];

export const checkoutReadinessItemSchema = z.object({
  id: z.enum(checkoutReadinessItemIdEnum),
  severity: z.enum(checkoutReadinessSeverityEnum),
  /**
   * Deep-link to the setup surface that resolves the reminder. `null`
   * when there is nothing to navigate to (the web layer only renders a
   * recovery button for manager/admin anyway).
   */
  cta: z
    .object({ route: z.string(), tab: z.string().optional() })
    .nullable(),
});

export type CheckoutReadinessItem = z.infer<typeof checkoutReadinessItemSchema>;

/** Input for `setupReadiness.checkout`: the site the cashier is selling at. */
export const checkoutReadinessInputSchema = z.object({
  siteId: z.string().min(1),
});

export const checkoutReadinessOutputSchema = z.object({
  items: z.array(checkoutReadinessItemSchema),
});

export type CheckoutReadinessOutput = z.infer<
  typeof checkoutReadinessOutputSchema
>;

/**
 * ENG-202 — Three milestones that take a new tenant to its first real sale.
 * The order is part of the public contract and mirrors the shell checklist.
 */
export const firstSaleReadinessStepIdEnum = [
  'product',
  'cashSession',
  'firstSale',
] as const;
export type FirstSaleReadinessStepId =
  (typeof firstSaleReadinessStepIdEnum)[number];

export const firstSaleReadinessInputSchema = z.object({
  siteId: z.string().min(1),
});

export const firstSaleReadinessStepSchema = z.object({
  id: z.enum(firstSaleReadinessStepIdEnum),
  completed: z.boolean(),
});

export const firstSaleReadinessOutputSchema = z.object({
  completed: z.boolean(),
  steps: z.array(firstSaleReadinessStepSchema).length(3),
});

export type FirstSaleReadinessOutput = z.infer<
  typeof firstSaleReadinessOutputSchema
>;
