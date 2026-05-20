/**
 * ENG-134 — axe-core helper for component tests.
 *
 * `assertNoA11yViolations(container)` runs axe against the rendered
 * subtree with the WCAG 2 AA ruleset by default and throws on any
 * serious or critical violation. Lower-severity issues (`moderate`,
 * `minor`) surface in the message but never fail the test — the
 * gate is intentionally narrow so adding it to a test does not
 * carry hidden failure paths.
 *
 * The helper is opt-in: existing tests stay green as long as they do
 * not call it. Pick it up when adding a new test for a UI surface
 * that exposes form fields, dialogs, icon-only buttons, or any
 * interactive widgets — the call documents the surface as
 * accessibility-tracked.
 *
 * Internally we drive `axe.run` directly (no `jest-axe`/`vitest-axe`
 * wrapper). Vitest's `expect` already produces readable failures, so
 * a custom matcher is not worth the dependency surface.
 *
 * @module test/a11y
 */

import axe from 'axe-core';
import type { RunOptions, AxeResults, NodeResult, Result } from 'axe-core';

const DEFAULT_RUN_OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  resultTypes: ['violations'],
};

interface AssertA11yOptions {
  /**
   * axe-core run options. Defaults to the WCAG 2 A + AA ruleset.
   * Pass `runOnly` to scope to a specific subset (rare; usually the
   * default is what you want).
   */
  runOptions?: RunOptions;
  /**
   * Severity floor: any violation at or above this level fails.
   * Default `serious`; bump to `moderate` for stricter audits on
   * critical surfaces (checkout, login, settings).
   */
  severityFloor?: 'minor' | 'moderate' | 'serious' | 'critical';
}

const SEVERITY_ORDER: Array<'minor' | 'moderate' | 'serious' | 'critical'> = [
  'minor',
  'moderate',
  'serious',
  'critical',
];

function severityRank(level: string | null | undefined): number {
  if (!level) return -1;
  return SEVERITY_ORDER.indexOf(
    level as 'minor' | 'moderate' | 'serious' | 'critical'
  );
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
        lines.push(
          `      ${node.failureSummary.split('\n').join('\n      ')}`
        );
      }
    }
    if (v.helpUrl) lines.push(`      helpUrl: ${v.helpUrl}`);
  }
  return lines.join('\n');
}

/**
 * Throws when `container` contains an axe violation at or above
 * `severityFloor`. Returns the raw axe `AxeResults` on success so
 * callers can do further assertions (e.g. snapshot the violation
 * list as the surface evolves).
 */
export async function assertNoA11yViolations(
  container: HTMLElement,
  options: AssertA11yOptions = {}
): Promise<AxeResults> {
  const { runOptions = DEFAULT_RUN_OPTIONS, severityFloor = 'serious' } =
    options;
  const results = await axe.run(container, runOptions);
  const floorRank = severityRank(severityFloor);
  const offending = results.violations.filter(
    v => severityRank(v.impact) >= floorRank
  );
  if (offending.length > 0) {
    throw new Error(
      `Accessibility violations (>= ${severityFloor}):\n${renderViolations(offending)}`
    );
  }
  return results;
}
