/**
 * ENG-001 Step 3 — Electron smoke test.
 *
 * Launches the Electron main process against a pre-seeded tmpdir DB
 * (see `global-setup.ts`), drives the first-window renderer through
 * the admin login, and asserts the dashboard shell rendered without
 * console errors.
 *
 * Kept deliberately minimal — a single happy-path flow that proves:
 *
 *   1. The Electron main process starts the embedded Fastify server
 *      in-process without crashing.
 *   2. The renderer loads the web dev bundle served by Playwright.
 *   3. The renderer can reach the embedded Fastify server through the
 *      same tRPC HTTP client used by the web app.
 *   4. The login flow round-trips with the seeded `e2e.admin@local.test`
 *      user and the admin lands on `/dashboard`.
 *   5. The admin-only backup-protection IPC reports SQLCipher and the
 *      development key source without exposing the key value.
 *   6. The admin can configure and create a real encrypted scheduled
 *      snapshot through the sandboxed preload bridge.
 *   7. No `console.error` / `pageerror` events fire during the flow —
 *      the contract enforced by the web suite's smoke also applies
 *      here.
 *
 * Extensive role / business-flow coverage stays in the web suite. The
 * Electron runner exists to catch main-process regressions (IPC
 * bridge, sandbox flags, embedded-server boot) that the web suite
 * cannot reach.
 *
 * @module e2e/electron/smoke
 */

import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { electronTest as test, ELECTRON_E2E_DB_KEY, expect } from './fixtures.js';
import { attachClientIssueTracker, E2E_USERS, expectNoClientIssues } from '../web/support/app.js';

test.describe('Electron smoke (ENG-001 Step 3)', () => {
  test('launches, logs in as admin, and loads the dashboard shell', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    const admin = E2E_USERS.admin;

    // The renderer boots on the login route by default (AuthProvider
    // redirects unauthenticated sessions there). Wait for the form to
    // render.
    const emailInput = page.getByLabel(/email/i);
    const passwordInput = page.getByRole('textbox', { name: /password/i });
    await expect(emailInput).toBeVisible({ timeout: 30_000 });
    await expect(passwordInput).toBeVisible();

    await emailInput.fill(admin.email);
    await passwordInput.fill(admin.password);
    await page
      .getByRole('button', { name: /enter workspace|entrar al espacio de trabajo/i })
      .click();

    // Dashboard shell — look for any element that the web suite's
    // smoke.spec.ts also keys off. The sidebar nav brand is the most
    // stable anchor because it renders for every authenticated role.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    // URL + shell are not enough: wait for a data-backed dashboard metric so
    // the smoke cannot pass (or capture evidence) while the lazy route still
    // shows its loading skeleton.
    await expect(page.getByText(/today's sales|ventas de hoy/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // Preserve the original shell evidence while the second screenshot below
    // records the new main-to-renderer protection contract.
    const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
    if (auditDir) {
      await mkdir(auditDir, { recursive: true });
      await page.screenshot({
        path: path.join(auditDir, 'electron-dashboard.png'),
        fullPage: true,
      });
    }

    // ENG-129e — exercise the real preload + IPC boundary, not a renderer
    // mock. Electron E2E injects PUNTOVIVO_DB_KEY deliberately, so the honest
    // status is the development-key variant even on macOS. The raw 64-hex key
    // must never appear in the renderer text.
    await page.goto(new URL('/company?tab=data', page.url()).toString());
    const protectionPanel = page.getByTestId('backup-protection-panel');
    await expect(protectionPanel).toBeVisible({ timeout: 30_000 });
    await expect(
      protectionPanel.getByText(/development key source|clave de desarrollo/i)
    ).toBeVisible();
    await expect(
      protectionPanel.getByText(/SQLCipher encrypted|cifrados con SQLCipher/i)
    ).toBeVisible();
    await expect(
      protectionPanel.getByText(
        /development environment variable|variable de entorno de desarrollo/i
      )
    ).toBeVisible();
    await expect(protectionPanel).not.toContainText(ELECTRON_E2E_DB_KEY);

    // ENG-136a — exercise schedule persistence + the real encrypted
    // VACUUM INTO snapshot. The app-managed folder avoids a native folder
    // picker in automation while proving the same main-process scheduler
    // used by daily/weekly runs.
    const schedulePanel = page.getByTestId('backup-schedule-panel');
    await expect(schedulePanel).toBeVisible();
    await expect(schedulePanel.getByTestId('backup-destination')).toContainText('backups');
    await schedulePanel
      .getByRole('combobox', { name: /snapshot frequency/i })
      .selectOption('daily');
    await schedulePanel.getByRole('button', { name: /save schedule/i }).click();
    await expect(schedulePanel.getByRole('combobox', { name: /snapshot frequency/i })).toHaveValue(
      'daily'
    );
    await schedulePanel.getByRole('button', { name: /create snapshot now/i }).click();
    await expect(schedulePanel.getByTestId('backup-last-success')).not.toHaveText(
      /not created yet/i,
      { timeout: 60_000 }
    );
    await expect(schedulePanel).not.toContainText(ELECTRON_E2E_DB_KEY);

    await expectNoClientIssues(tracker);

    // Optional evidence path shared with the web smoke specs. Normal CI stays
    // artifact-free; audit runs opt in with PUNTOVIVO_AUDIT_DIR.
    if (auditDir) {
      await page.screenshot({
        path: path.join(auditDir, 'electron-backup-protection.png'),
        fullPage: true,
      });
      await schedulePanel.screenshot({
        path: path.join(auditDir, 'electron-scheduled-snapshot.png'),
      });
    }
  });
});
