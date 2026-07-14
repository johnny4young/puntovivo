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
 *      snapshot through the sandboxed preload bridge, with an optional
 *      S3-compatible second copy written through the real AWS client.
 *   7. A non-destructive restore drill verifies that snapshot, reports
 *      tenant-scoped differences, and leaves an immutable audit event.
 *   8. No `console.error` / `pageerror` events fire during the flow —
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
import { startFakeS3Provider } from './support/fake-s3.js';

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
    // Keep this as an SPA transition. A hard page.goto reload races the
    // desktop-session bridge re-registration and made this smoke intermittently
    // observe the Company fallback before the lazy data panel committed.
    await page
      .getByTestId('sidebar-workspace-link-setup')
      .evaluate(link => (link as HTMLElement).click());
    await expect(page).toHaveURL(/\/company/);
    await page.getByTestId('company-tab-data').click();
    await expect(page).toHaveURL(/\/company\?tab=data/);
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

    // ENG-136c — configure a device-local vault against a deterministic
    // S3-compatible endpoint. The renderer provides write-only credentials;
    // the real main process seals them and the AWS client signs each PUT.
    const cloudPanel = page.getByTestId('backup-cloud-vault-panel');
    await expect(cloudPanel).toBeVisible();
    const secureStorageAlert = cloudPanel.getByRole('alert');
    const secureStorageAvailable = !(await secureStorageAlert.isVisible().catch(() => false));
    const fakeS3 = secureStorageAvailable ? await startFakeS3Provider() : null;
    const schedulePanel = page.getByTestId('backup-schedule-panel');

    try {
      if (fakeS3) {
        await cloudPanel.getByLabel(/S3 endpoint/i).fill(fakeS3.endpoint);
        await cloudPanel.getByLabel(/region|región/i).fill('auto');
        await cloudPanel.getByLabel(/bucket/i).fill('merchant-backups');
        await cloudPanel.getByLabel(/object prefix|prefijo de objetos/i).fill('puntovivo-e2e');
        await cloudPanel.getByLabel(/access key ID|ID de clave de acceso/i).fill('PVE2EACCESS1234');
        await cloudPanel
          .getByLabel(/secret access key|clave de acceso secreta/i)
          .fill('puntovivo-e2e-secret');
        await cloudPanel.getByRole('button', { name: /save and test|guardar y probar/i }).click();
        await expect(cloudPanel.getByTestId('backup-cloud-connected-badge')).toBeVisible({
          timeout: 30_000,
        });
        await expect(cloudPanel).toContainText('••••1234');
        await expect(cloudPanel.getByTestId('backup-cloud-last-object')).toContainText(
          '.puntovivo-connection-test'
        );
        await expect.poll(() => fakeS3.uploads.length).toBe(1);
        expect(fakeS3.uploads[0]).toMatchObject({
          method: 'PUT',
          contentType: 'text/plain; charset=utf-8',
          bodyText: 'Puntovivo cloud backup connection test\n',
        });
        expect(fakeS3.uploads[0]?.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
        expect(fakeS3.uploads[0]?.url).toMatch(
          /^\/merchant-backups\/puntovivo-e2e\/[^/]+\/\.puntovivo-connection-test\?x-id=PutObject$/
        );
      } else {
        await expect(secureStorageAlert).toBeVisible();
        await expect(
          cloudPanel.getByRole('button', { name: /save and test|guardar y probar/i })
        ).toBeDisabled();
      }

      // ENG-136a — exercise schedule persistence + the real encrypted
      // VACUUM INTO snapshot. The app-managed folder avoids a native folder
      // picker in automation while proving the same main-process scheduler
      // used by daily/weekly runs.
      await expect(schedulePanel).toBeVisible();
      await expect(schedulePanel.getByTestId('backup-destination')).toContainText('backups');
      await schedulePanel
        .getByRole('combobox', { name: /snapshot frequency/i })
        .selectOption('daily');
      await schedulePanel.getByRole('button', { name: /save schedule/i }).click();
      await expect(
        schedulePanel.getByRole('combobox', { name: /snapshot frequency/i })
      ).toHaveValue('daily');
      await schedulePanel
        .getByRole('button', { name: /create snapshot now|crear respaldo ahora/i })
        .click();
      await expect(schedulePanel.getByTestId('backup-last-success')).not.toHaveText(
        /not created yet|aún no se ha creado/i,
        { timeout: 60_000 }
      );
      await expect(schedulePanel).not.toContainText(ELECTRON_E2E_DB_KEY);

      if (fakeS3) {
        await expect.poll(() => fakeS3.uploads.length, { timeout: 30_000 }).toBe(2);
        expect(fakeS3.uploads[1]?.method).toBe('PUT');
        expect(fakeS3.uploads[1]?.contentType).toBe('application/zip');
        expect(fakeS3.uploads[1]?.bodyLength).toBeGreaterThan(0);
        expect(fakeS3.uploads[1]?.bodySignature).toBe('504b0304');
        expect(fakeS3.uploads[1]?.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
        expect(fakeS3.uploads[1]?.url).toMatch(
          /^\/merchant-backups\/puntovivo-e2e\/[^/]+\/puntovivo-backup-.+\.zip\?x-id=PutObject$/
        );
        await expect(cloudPanel.getByTestId('backup-cloud-last-object')).toContainText('.zip');
      }
    } finally {
      await fakeS3?.close();
    }

    // ENG-136b — the real main process extracts and opens the encrypted
    // snapshot in a temporary directory, compares only this tenant's rows,
    // and returns bounded metadata through preload. No destructive restore or
    // renderer-supplied path participates in this flow.
    const drillPanel = page.getByTestId('backup-restore-drill-panel');
    await expect(drillPanel).toBeVisible();
    await drillPanel.getByTestId('run-backup-restore-drill').click();
    const drillReport = drillPanel.getByTestId('backup-restore-drill-report');
    await expect(drillReport.getByText(/ready to restore/i)).toBeVisible({ timeout: 60_000 });
    await expect(drillReport.getByRole('row', { name: /products/i })).toBeVisible();
    await expect(drillReport.getByRole('row', { name: /sales/i })).toBeVisible();
    await expect(drillReport).toContainText(/live database was not changed/i);
    await expect(drillReport).not.toContainText(ELECTRON_E2E_DB_KEY);

    // Optional evidence path shared with the web smoke specs. Capture the
    // Company data surface before navigating to the audit history below.
    if (auditDir) {
      await page.screenshot({
        path: path.join(auditDir, 'electron-backup-protection.png'),
        fullPage: true,
      });
      await schedulePanel.screenshot({
        path: path.join(auditDir, 'electron-scheduled-snapshot.png'),
      });
      await cloudPanel.screenshot({
        path: path.join(auditDir, 'electron-cloud-vault.png'),
      });
      await drillPanel.screenshot({
        path: path.join(auditDir, 'electron-restore-drill.png'),
      });
    }

    // Review proof: switch the live renderer to neutral LATAM Spanish and
    // assert the newly added cloud surface without reloading the desktop app.
    const languageTrigger = page
      .locator('header button[aria-haspopup="listbox"]')
      .filter({ hasText: /System|Sistema|English|Español/ })
      .first();
    await languageTrigger.click();
    await page.getByRole('option', { name: 'Español' }).click();
    await expect(
      cloudPanel.getByRole('heading', { name: 'Bóveda en la nube compatible con S3' })
    ).toBeVisible();
    await expect(cloudPanel.getByRole('button', { name: 'Probar conexión' })).toBeVisible();
    if (auditDir) {
      await cloudPanel.screenshot({
        path: path.join(auditDir, 'electron-cloud-vault-es.png'),
      });
    }

    // The drill is a sensitive admin capability, so success must be visible in
    // the same immutable tenant audit history exposed to the operator.
    // Use the existing React Router link without forcing the responsive
    // sidebar open. The scheduled snapshot must not restart the embedded
    // server or invalidate this authenticated renderer session.
    await page.locator('a[href="/audit-logs"]').evaluate(link => (link as HTMLElement).click());
    await expect(page).toHaveURL(/\/audit-logs/);
    await expect(
      page.getByRole('row', {
        name: /backup restore drill run|simulacro de restauración ejecutado/i,
      })
    ).toBeVisible({ timeout: 30_000 });

    await expectNoClientIssues(tracker);
  });
});
