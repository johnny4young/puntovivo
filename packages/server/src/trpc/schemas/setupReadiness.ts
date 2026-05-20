/**
 * ENG-104 — Setup readiness Zod schemas.
 *
 * Output shape consumed by `setupReadiness.get` and rendered by the
 * `CompanyReadinessCard` + `ReadinessBanner`. The section ids are a
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
] as const;
export type SetupReadinessSectionId = (typeof setupReadinessSectionIdEnum)[number];

/**
 * - `ready`: the underlying signal is configured and operational.
 * - `blocker`: the operator cannot run the day without this (e.g.
 *   no products in catalog, no sites). Counted by `blockerCount`.
 * - `optional-pending`: nice-to-have but not blocking the daily flow
 *   (e.g. zero peripherals registered, only manual payment rails).
 *   Counted at half-weight by the score.
 * - `not-applicable`: the tenant opted out of the feature (e.g. AI
 *   master toggle off, fiscal disabled for non-Colombian tenant) and
 *   the section is excluded from the score denominator.
 */
export const setupReadinessStatusEnum = [
  'ready',
  'blocker',
  'optional-pending',
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
