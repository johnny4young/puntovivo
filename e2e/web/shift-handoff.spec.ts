import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  expectSuccessToast,
  login,
} from './support/app';
import { closeTenantCashSessions, getAuditLog, seedShiftHandoffScenario } from './support/db';

/** Optional light and dark evidence for design review; the journey never depends on it. */
async function capture(page: Page, name: string) {
  const dir = process.env.PUNTOVIVO_SHOTS_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.screenshot({ path: path.join(dir, `${name}-${colorScheme}.png`), animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test.describe('shift handoff and the guided close', () => {
  test('hands the drawer over, receives it, explains the difference and seals the day', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = seedShiftHandoffScenario(
      `shift-handoff-${testInfo.parallelIndex}-${Date.now()}`
    );
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page, { ...scenario.cashier, defaultPath: '/sales' });

    await page.getByRole('button', { name: 'Close cash session' }).first().click();
    await page.getByTestId('close-session-hand-out').click();
    const handOut = page.getByTestId('hand-out-dialog');
    await expect(handOut).toBeVisible();
    await page.getByTestId('denomination-plus-50000').click();
    await page.getByTestId('denomination-plus-50000').click();
    await expect(page.getByTestId('hand-out-total')).toContainText('100');
    await page.getByTestId('hand-out-continue').click();
    await expect(page.getByTestId('hand-out-count-saved')).toBeVisible();
    await page.getByTestId('hand-out-note').fill('The supplier comes back at 3');
    await capture(page, 'shift-handoff-out');
    await page.getByTestId('hand-out-review').click();
    await page.getByTestId('hand-out-sign').click();
    await expectSuccessToast(page, 'Shift handed over');
    await expect(handOut).toBeHidden();
    expect(getAuditLog('cash_session.handoff_out', scenario.cashSessionId)).not.toBeNull();
    await expectNoClientIssues(tracker);

    const managerContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const manager = await managerContext.newPage();
    const managerTracker = attachClientIssueTracker(manager);
    await manager.addInitScript(
      ({ key, siteId }) => window.localStorage.setItem(key, siteId),
      { key: `active_site_id:${scenario.tenantId}`, siteId: scenario.activeSite.id }
    );
    await login(manager, { ...scenario.manager, defaultPath: '/dashboard' });
    await manager.goto('/sales');
    await manager.getByRole('button', { name: 'Open cash session' }).first().click();
    const receive = manager.getByTestId('receive-dialog');
    await expect(receive).toBeVisible();
    await expect(manager.getByTestId('receive-note')).toContainText('The supplier comes back at 3');
    await manager.getByTestId('denomination-plus-50000').click();
    await manager.getByTestId('denomination-plus-50000').click();
    await expect(manager.getByTestId('receive-match')).toHaveAttribute('data-state', 'match');
    await capture(manager, 'shift-handoff-receive');
    await manager.getByTestId('receive-submit').click();
    await expectSuccessToast(manager, 'Register received');
    await expect(receive).toBeHidden();
    await expect(manager.getByRole('button', { name: 'Close cash session' }).first()).toBeVisible();

    await manager.goto('/dashboard');
    await expect(manager.getByTestId('today-handoff').first()).toContainText('handoff done');
    await manager.getByTestId('today-difference-explain').first().click();
    const guide = manager.getByTestId('close-guide');
    await expect(guide).toBeVisible();
    const difference = manager.getByTestId(`close-guide-difference-${scenario.cashSessionId}`);
    await difference.getByTestId('close-guide-reason-wrong_change').click();
    await expect(difference).toContainText('explained');
    await capture(manager, 'shift-handoff-close-guide');
    await manager.keyboard.press('Escape');
    await expect(guide).toBeHidden();

    closeTenantCashSessions(scenario.tenantId);
    await manager.reload();
    await manager.getByTestId('today-close-day').click();
    await expect(manager.getByTestId('close-guide-registers')).toContainText('Registers closed');
    const pad = manager.getByTestId('close-guide-signature-pad');
    const box = (await pad.boundingBox())!;
    await manager.mouse.move(box.x + 40, box.y + 100);
    await manager.mouse.down();
    await manager.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
    await manager.mouse.move(box.x + 220, box.y + 110, { steps: 8 });
    await manager.mouse.up();
    await manager.getByTestId('close-guide-sign').click();
    await expectSuccessToast(manager, 'Day signed and sealed');
    await expect(manager.getByTestId('close-guide-stamp')).toBeVisible();
    await expect(manager.getByTestId('close-guide-signature-image')).toBeVisible();
    await expect(manager.getByTestId('close-guide-arc')).toBeVisible();
    await capture(manager, 'shift-handoff-sealed');

    await expectNoClientIssues(managerTracker);
    await managerContext.close();
  });
});
