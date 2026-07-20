/**
 * slice B — axe-core helper for Playwright e2e smoke.
 *
 * Mirrors the contract of `apps/web/src/test/a11y.ts` used by the
 * component-test suite, so a failure message reads identically across
 * both surfaces: WCAG 2 A + AA tag set, serious-floor by default, and
 * the same indented bullet output. The helper drives `AxeBuilder`
 * from `@axe-core/playwright` against a real Chromium page, so it
 * exercises browser-level a11y signals that jsdom cannot (computed
 * styles, layout, ARIA tree resolution).
 *
 * The helper is opt-in per test — adding it documents the route as
 * a11y-tracked. Each call returns the raw axe results so callers can
 * snapshot the violation list as the surface evolves.
 *
 * @module e2e/web/support/a11y
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { AxeResults, NodeResult, Result } from 'axe-core';

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa'];

const SEVERITY_ORDER: Array<'minor' | 'moderate' | 'serious' | 'critical'> = [
  'minor',
  'moderate',
  'serious',
  'critical',
];

type SeverityFloor = (typeof SEVERITY_ORDER)[number];

interface RunAxeOptions {
  /**
   * CSS selector(s) to restrict the scan to a subtree. Defaults to
   * the whole document.
   */
  include?: string | string[];
  /**
   * CSS selector(s) to exclude from the scan.
   */
  exclude?: string | string[];
  /**
   * Severity floor. Any violation at or above this level fails.
   * Default `serious`, matching the component helper.
   */
  severityFloor?: SeverityFloor;
  /**
   * Additional WCAG / best-practice tags to include beyond the
   * default WCAG 2 A + AA set. Rarely needed; included for
   * future strictness bumps.
   */
  extraTags?: string[];
}

function severityRank(level: string | null | undefined): number {
  if (!level) return -1;
  return SEVERITY_ORDER.indexOf(level as SeverityFloor);
}

function renderNodeTarget(node: NodeResult): string {
  if (Array.isArray(node.target) && node.target.length > 0) {
    return node.target.join(' ');
  }
  return '<unknown selector>';
}

function renderViolations(violations: Result[]): string {
  const lines: string[] = [];
  for (const v of violations) {
    lines.push(`  - [${v.impact ?? '?'}] ${v.id}: ${v.help}`);
    for (const node of v.nodes) {
      lines.push(`      target: ${renderNodeTarget(node)}`);
      if (node.failureSummary) {
        lines.push(`      ${node.failureSummary.split('\n').join('\n      ')}`);
      }
    }
    if (v.helpUrl) lines.push(`      helpUrl: ${v.helpUrl}`);
  }
  return lines.join('\n');
}

/**
 * Axe reads the currently composited foreground/background colors. Wait for
 * finite entrance transitions first so a scan never samples a translucent
 * modal halfway through animate-pop-in. Infinite progress indicators are
 * intentionally ignored because they do not converge to a final frame.
 */
async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.getAnimations().every(animation => {
        if (animation.playState !== 'running') return true;
        const endTime = animation.effect?.getComputedTiming().endTime;
        return typeof endTime === 'number' && !Number.isFinite(endTime);
      }),
    undefined,
    { timeout: 2_000 }
  );
}

/**
 * Run axe-core against `page` on the WCAG 2 A + AA ruleset and throw
 * when any violation lands at or above `severityFloor` (default
 * `serious`). Returns the raw `AxeResults` so callers can do follow-up
 * assertions on the lower-severity surface if needed.
 */
export async function runAxeOnPage(page: Page, options: RunAxeOptions = {}): Promise<AxeResults> {
  const { include, exclude, severityFloor = 'serious', extraTags = [] } = options;

  await waitForFiniteAnimations(page);

  let builder = new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS, ...extraTags]);
  if (include) builder = builder.include(include);
  if (exclude) builder = builder.exclude(exclude);

  const results = await builder.analyze();
  const floorRank = severityRank(severityFloor);
  const offending = results.violations.filter(v => severityRank(v.impact) >= floorRank);

  if (offending.length > 0) {
    throw new Error(
      `Accessibility violations (>= ${severityFloor}):\n${renderViolations(offending)}`
    );
  }

  return results;
}
