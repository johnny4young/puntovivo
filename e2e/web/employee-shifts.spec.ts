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
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(100);
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: path.join(auditDir, `${name}.png`),
  });
}

test.describe('employee time clock and breaks (ENG-106b / ENG-140b)', () => {
  test('persists shifts and explicit breaks across the user menu in both locales', async ({
    page,
  }) => {
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
        const staleEndBreak = timeClock.getByRole('button', { name: 'End break' });
        if (await staleEndBreak.isVisible()) await staleEndBreak.click();
        await staleClockOut.click();
      }
      await expect(timeClock.getByRole('button', { name: 'Clock in' })).toBeVisible();
      await expect(timeClock.getByText(/Site:/)).toBeVisible();
      await timeClock.getByRole('button', { name: 'Clock in' }).click();
      await expect(timeClock.getByText(/Clocked in/)).toBeVisible();
      await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeVisible();
      await timeClock.getByRole('button', { name: 'Start break' }).click();
      await expect(timeClock.getByText(/On break since/)).toBeVisible();
      await expect(timeClock.getByRole('button', { name: 'Clock out' })).toBeDisabled();
      await captureEvidence(page, 'eng-140b-active-break-en');

      // Close/reopen the popover so the assertion reads server state rather
      // than only the mutation's optimistic UI lifecycle.
      await openUserMenu(page);
      await openUserMenu(page);
      timeClock = page.getByRole('region', { name: 'Time clock' });
      await expect(timeClock.getByRole('button', { name: 'End break' })).toBeVisible();
      await timeClock.getByRole('button', { name: 'End break' }).click();
      await expect(timeClock.getByRole('button', { name: 'Start break' })).toBeVisible();
      await timeClock.getByRole('button', { name: 'Clock out' }).click();
      await expect(timeClock.getByRole('button', { name: 'Clock in' })).toBeVisible();

      await ensureLanguage(page, 'es');
      await openUserMenu(page);
      const reloj = page.getByRole('region', { name: 'Control de turno' });
      await reloj.getByRole('button', { name: 'Marcar entrada' }).click();
      await expect(reloj.getByText(/Entrada registrada/)).toBeVisible();
      await expect(reloj.getByText(/Sede:/)).toBeVisible();
      await reloj.getByRole('button', { name: 'Iniciar pausa' }).click();
      await expect(reloj.getByText(/En pausa desde/)).toBeVisible();
      await expect(reloj.getByRole('button', { name: 'Marcar salida' })).toBeDisabled();
      await captureEvidence(page, 'eng-140b-active-break-es');
      await reloj.getByRole('button', { name: 'Finalizar pausa' }).click();
      await reloj.getByRole('button', { name: 'Marcar salida' }).click();
      await expect(reloj.getByRole('button', { name: 'Marcar entrada' })).toBeVisible();

      await page.goto('/schedule');
      const attendance = page.getByTestId('team-attendance-panel');
      await expect(attendance.getByRole('heading', { name: 'Asistencia real' })).toBeVisible();
      await expect(attendance.getByText('Tiempo en pausa').first()).toBeVisible();
      await expect(attendance.getByText(/Detalle de pausa \(1\)/).first()).toBeVisible();
      await captureEvidence(page, 'eng-140b-attendance-es');

      await ensureLanguage(page, 'en');
      await expect(attendance.getByRole('heading', { name: 'Actual attendance' })).toBeVisible();
      await expect(attendance.getByText('Break time').first()).toBeVisible();
      await captureEvidence(page, 'eng-140b-attendance-en');

      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await captureEvidence(page, 'eng-140b-attendance-mobile-en');

      await ensureLanguage(page, 'es');
      await expect(attendance.getByRole('heading', { name: 'Asistencia real' })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await captureEvidence(page, 'eng-140b-attendance-mobile-es');

      await openUserMenu(page);
      const mobileClock = page.getByRole('region', { name: 'Control de turno' });
      await mobileClock.getByRole('button', { name: 'Marcar entrada' }).click();
      await mobileClock.getByRole('button', { name: 'Iniciar pausa' }).click();
      await expect(mobileClock.getByRole('button', { name: 'Marcar salida' })).toBeDisabled();
      await captureEvidence(page, 'eng-140b-active-break-mobile-es');
      await mobileClock.getByRole('button', { name: 'Finalizar pausa' }).click();
      await mobileClock.getByRole('button', { name: 'Marcar salida' }).click();
      await expect(mobileClock.getByRole('button', { name: 'Marcar entrada' })).toBeVisible();

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
        const endBreak = page.getByRole('button', { name: /^(?:End break|Finalizar pausa)$/ });
        if (await endBreak.isVisible()) {
          await endBreak.click();
          await expect(endBreak).toBeHidden();
        }
        const refreshedClockOut = page.getByRole('button', {
          name: /^(?:Clock out|Marcar salida)$/,
        });
        if (await refreshedClockOut.isVisible()) await refreshedClockOut.click();
      }
    }
  });
});
