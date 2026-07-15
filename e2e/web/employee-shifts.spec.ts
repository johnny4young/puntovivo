import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
  openUserMenu,
} from './support/app';

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: path.join(auditDir, `${name}.png`),
  });
}

test.describe('employee time clock baseline (ENG-106b)', () => {
  test('persists clock-in/out state across the user menu in both locales', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin');

    try {
      await openUserMenu(page);
      let timeClock = page.getByRole('region', { name: 'Time clock' });
      await expect(
        timeClock.getByRole('button', { name: /^(?:Clock in|Clock out)$/ })
      ).toBeVisible();
      const staleClockOut = timeClock.getByRole('button', { name: 'Clock out' });
      if (await staleClockOut.isVisible()) {
        await staleClockOut.click();
      }
      await expect(timeClock.getByRole('button', { name: 'Clock in' })).toBeVisible();
      await expect(timeClock.getByText(/Site:/)).toBeVisible();
      await timeClock.getByRole('button', { name: 'Clock in' }).click();
      await expect(timeClock.getByText(/Clocked in/)).toBeVisible();
      await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeVisible();
      await captureEvidence(page, 'eng-106b-clocked-in-en');

      // Close/reopen the popover so the assertion reads server state rather
      // than only the mutation's optimistic UI lifecycle.
      await openUserMenu(page);
      await openUserMenu(page);
      timeClock = page.getByRole('region', { name: 'Time clock' });
      await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeVisible();
      await timeClock.getByRole('button', { name: 'Clock out' }).click();
      await expect(timeClock.getByRole('button', { name: 'Clock in' })).toBeVisible();

      await ensureLanguage(page, 'es');
      await openUserMenu(page);
      const reloj = page.getByRole('region', { name: 'Control de turno' });
      await reloj.getByRole('button', { name: 'Marcar entrada' }).click();
      await expect(reloj.getByText(/Entrada registrada/)).toBeVisible();
      await expect(reloj.getByText(/Sede:/)).toBeVisible();
      await captureEvidence(page, 'eng-106b-clocked-in-es');
      await reloj.getByRole('button', { name: 'Marcar salida' }).click();
      await expect(reloj.getByRole('button', { name: 'Marcar entrada' })).toBeVisible();

      await expectNoClientIssues(tracker);
    } finally {
      // Retries run without repeating global setup. Never strand the shared
      // template admin in an open shift after an assertion failure.
      const menu = page.locator('#header-user-menu');
      if (!(await menu.isVisible())) {
        await openUserMenu(page);
      }
      const clockOut = page.getByRole('button', { name: /^(?:Clock out|Marcar salida)$/ });
      if (await clockOut.isVisible()) {
        await clockOut.click();
      }
    }
  });
});
