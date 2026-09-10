import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { electronTest as test } from './fixtures.js';
import {
  runSchedulePlansJourney,
  assertSchedulePlansDiagnostics,
  runSchedulePlansAdminAudit,
} from '../shared/schedule-plans-journey.js';
import { attachClientIssueTracker } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

test('recurring plans publish once and retain frozen evidence in embedded desktop', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  // The custom Electron fixture's context is not Playwright's built-in web
  // context. Explicitly retain its network/DOM trace, including on failure.
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await signIn(page, 'e2e.admin@local.test');
    const result = await runSchedulePlansJourney(page, {
      singleFrameAxe: true,
      navigate: route => goToRoute(page, route),
      signInManager: email => signIn(page, email),
      screenshot: async name => {
        await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
      },
    });
    assertSchedulePlansDiagnostics(tracker, result.conflictUrl);
  } finally {
    await info.attach('client-diagnostics', {
      body: JSON.stringify(tracker.getIssues(), null, 2),
      contentType: 'application/json',
    });
    await page.context().tracing.stop({ path: info.outputPath('renderer-trace.zip') });
  }
});

test('administrator reads privacy-minimal recurring-plan audit in EN and ES after reload', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');
  await goToRoute(page, '/schedule');
  await page.getByRole('button', { name: 'Recurring plans', exact: true }).click();
  const suffix = randomUUID().slice(0, 8);
  // Independent actor fixture keeps the production HTTP throttle in force.
  // All five audit events are produced through UI, never inserted into SQLite.
  for (const publish of [true, false]) {
    await page.getByRole('button', { name: 'Create recurring draft', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Plan name').fill(`Audit plan ${publish} ${suffix}`);
    await dialog.getByLabel('First starting date').fill('2026-09-07');
    await dialog.getByLabel('Exclusive last starting date').fill('2026-09-09');
    await dialog.getByLabel('Reference Monday').fill('2026-09-07');
    await dialog.getByRole('button', { name: 'Add recurrence rule' }).click();
    const employee = dialog.getByRole('combobox', { name: 'Employee', exact: true });
    await expect(employee).toBeEnabled();
    await employee.selectOption({ index: 1 });
    await dialog.getByLabel('Tuesday', { exact: true }).check();
    await dialog.getByLabel('Operational notes (optional)').fill(`Private plan notes ${suffix}`);
    await dialog.getByRole('button', { name: 'Save and preview draft' }).click();
    dialog = page.getByRole('dialog', { name: 'Review plan', exact: true });
    await expect(dialog.getByTestId('plan-occurrence')).toHaveCount(2);
    if (publish) {
      await dialog.getByRole('button', { name: 'Regenerate draft' }).click();
      dialog = page.getByRole('dialog', { name: 'Regenerate draft', exact: true });
      await dialog.getByLabel('End time', { exact: true }).fill('16:00');
      await dialog.getByLabel('Private operational reason').fill(`Private regeneration ${suffix}`);
      await dialog.getByRole('button', { name: 'Save and preview draft' }).click();
      dialog = page.getByRole('dialog', { name: 'Review plan', exact: true });
      await expect(dialog).toContainText('Version 2');
      await dialog.getByRole('button', { name: 'Publish shifts', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Publish shifts', exact: true });
      await dialog.getByLabel('I reviewed this plan and want to publish all its shifts.').check();
      await dialog.getByRole('button', { name: 'Confirm publication' }).click();
    } else {
      await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Discard draft', exact: true });
      await dialog.getByLabel('Private operational reason').fill(`Private discard ${suffix}`);
      await dialog.getByRole('button', { name: 'Confirm discard' }).click();
    }
    await expect(dialog).toBeHidden();
    dialog = page.getByRole('dialog', { name: 'Review plan', exact: true });
    await expect(dialog).toContainText(publish ? 'Published' : 'Discarded');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await runSchedulePlansAdminAudit(
    page,
    {
      navigate: route => goToRoute(page, route),
      screenshot: async name => {
        await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
      },
    },
    suffix
  );
  expect(tracker.getIssues()).toEqual([]);
});
