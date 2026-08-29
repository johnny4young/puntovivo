/**
 * Step 3 — Electron smoke test.
 *
 * Launches the Electron main process against a pre-seeded tmpdir DB
 * (see `global-setup.ts`), drives the first-window renderer through
 * the admin login, and asserts the dashboard shell rendered without
 * console errors.
 *
 * Kept deliberately minimal — a single happy-path flow that proves:
 *
 * 1. The Electron main process starts the embedded Fastify server
 * in-process without crashing.
 * 2. The renderer loads the web dev bundle served by Playwright.
 * 3. The renderer can reach the embedded Fastify server through the
 * same tRPC HTTP client used by the web app.
 * 4. The login flow round-trips with the seeded `e2e.admin@local.test`
 * user and the admin lands on `/dashboard`.
 * 5. The admin-only backup-protection IPC reports SQLCipher and the
 * development key source without exposing the key value.
 * 6. The admin can configure and create a real encrypted scheduled
 * snapshot through the sandboxed preload bridge, with an optional
 * S3-compatible second copy written through the real AWS client.
 * 7. A non-destructive restore drill verifies that snapshot, reports
 * tenant-scoped differences, and leaves an immutable audit event.
 * 8. No `console.error` / `pageerror` events fire during the flow —
 * the contract enforced by the web suite's smoke also applies
 * here.
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
import { goToRoute } from './support/journey.js';

test.describe('Electron smoke', () => {
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

    // The emergency playbook must lead to a real desktop recovery surface,
    // not a decorative support card. The isolated E2E install owns a disposable
    // encrypted database, so asserting the restore control is enabled is safe.
    await goToRoute(page, '/operations');
    await page.getByTestId('operations-support-toggle').click();
    await page.getByTestId('operations-tab-support').click();
    await expect(page.getByTestId('support-playbook-damagedStorage')).toContainText(
      'This workstation cannot open its data'
    );
    await page.getByTestId('support-playbook-action-damagedStorage').click();
    await expect(page).toHaveURL(/\/company\?tab=data&focus=backup-restore$/, { timeout: 30_000 });
    const backupRestoreTarget = page.getByTestId('company-backup-restore-target');
    await expect(backupRestoreTarget).toBeFocused();
    await expect(backupRestoreTarget).toBeInViewport();
    await expect(
      backupRestoreTarget.getByRole('button', {
        name: /restore backup|restaurar respaldo/i,
      })
    ).toBeEnabled();

    // exercise the real preload + IPC boundary, not a renderer
    // mock. Electron E2E injects PUNTOVIVO_DB_KEY deliberately, so the honest
    // status is the development-key variant even on macOS. The raw 64-hex key
    // must never appear in the renderer text.
    // Keep this as an SPA transition. A hard page.goto reload races the
    // desktop-session bridge re-registration and made this smoke intermittently
    // observe the Company fallback before the lazy data panel committed. The
    // setup workspace now lives behind More tools, so use the target-agnostic
    // route helper rather than relying on a currently hidden sidebar link.
    await goToRoute(page, '/company');

    // exercise the real updater IPC contract before moving to the
    // data tab. A fresh E2E userData directory establishes the installed
    // version baseline without inventing a last-updated timestamp; development
    // builds also have no release rollout policy to report.
    await page.getByTestId('company-advanced-toggle').click();
    await page.getByTestId('company-tab-device').click();
    await expect(page).toHaveURL(/\/company\?tab=device/);
    const updaterPanel = page
      .getByTestId('company-tabpanel-device')
      .locator('section')
      .filter({
        has: page.getByRole('heading', {
          name: /app updates|actualizaciones de la app/i,
        }),
      });
    await expect(updaterPanel).toBeVisible();
    await expect(updaterPanel.getByText(/last updated|última actualización/i)).toBeVisible();
    await expect(updaterPanel.getByText(/rollout|despliegue/i)).toBeVisible();
    await expect(updaterPanel.getByText(/not yet|aún no/i).first()).toBeVisible();

    const desktopUpdateStatus = await page.evaluate(() => window.electron?.getAutoUpdateStatus());
    expect(desktopUpdateStatus).toMatchObject({
      lastUpdatedAt: null,
      rolloutMode: null,
      rolloutPercentage: null,
      rolloutTargetVersion: null,
      rolloutPolicyCheckedAt: null,
    });

    if (auditDir) {
      await updaterPanel.screenshot({
        path: path.join(auditDir, 'electron-app-updates.png'),
      });
    }

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

    // Exercise the passphrase UX in the real sandboxed renderer. The
    // generated phrase must come from Web Crypto, remain recoverable to the
    // operator, and the new cancellation IPC must cross preload/main without
    // exposing a stale-session Electron rejection. There is deliberately no
    // active backup here, so the bounded cancellation result is false.
    await backupRestoreTarget
      .getByRole('button', { name: /create backup|crear respaldo/i, exact: true })
      .click();
    const passphraseDialog = page.getByRole('dialog', {
      name: /create backup|crear respaldo/i,
    });
    await expect(passphraseDialog).toBeVisible();
    await passphraseDialog.getByTestId('backup-generate-passphrase').click();
    const generatedPassphrase = passphraseDialog.getByTestId('backup-create-passphrase');
    await expect(generatedPassphrase).toHaveAttribute('type', 'text');
    await expect(generatedPassphrase).toHaveValue(/^[A-Za-z0-9_-]{8}(?:\.[A-Za-z0-9_-]{8}){3}$/);
    await expect(passphraseDialog.getByTestId('backup-passphrase-feedback')).toContainText(
      /generated locally with cryptographic randomness|se generó localmente con aleatoriedad criptográfica/i
    );
    await passphraseDialog.getByRole('button', { name: /hide passphrase|ocultar frase/i }).click();
    await expect(generatedPassphrase).toHaveAttribute('type', 'password');
    expect(await page.evaluate(() => window.electron?.cancelDatabaseBackup?.())).toEqual({
      success: false,
    });

    if (auditDir) {
      await passphraseDialog.screenshot({
        path: path.join(auditDir, 'electron-backup-passphrase.png'),
      });
    }
    await passphraseDialog.getByRole('button', { name: /^cancel$|^cancelar$/i }).click();
    await expect(passphraseDialog).toBeHidden();

    // configure a device-local vault against a deterministic
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

      // exercise schedule persistence + the real encrypted
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

    // the real main process extracts and opens the encrypted
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

    await backupRestoreTarget
      .getByRole('button', { name: /create backup|crear respaldo/i, exact: true })
      .click();
    await passphraseDialog.getByTestId('backup-generate-passphrase').click();
    await expect(passphraseDialog.getByTestId('backup-passphrase-feedback')).toContainText(
      'Se generó localmente con aleatoriedad criptográfica'
    );
    if (auditDir) {
      await passphraseDialog.screenshot({
        path: path.join(auditDir, 'electron-backup-passphrase-es.png'),
      });
    }
    await passphraseDialog.getByRole('button', { name: /^cancelar$/i }).click();
    await expect(passphraseDialog).toBeHidden();

    // The drill is a sensitive admin capability, so success must be visible in
    // the same immutable tenant audit history exposed to the operator. The
    // Finance workspace lives behind More tools on frequent-task routes; use
    // the same target-agnostic SPA transition as the earlier setup navigation.
    await goToRoute(page, '/audit-logs');
    await expect(
      page.getByRole('row', {
        name: /backup restore drill run|simulacro de restauración ejecutado/i,
      })
    ).toBeVisible({ timeout: 30_000 });

    // Simulate the narrow renderer/main split-brain window this band closes:
    // renderer auth is still visible, but the verified main-process session
    // has been cleared. A gated settings mutation must show localized recovery
    // UX, never Electron's raw invoke wrapper, and its explicit action must run
    // the normal auth purge before returning to login.
    await goToRoute(page, '/company');
    await page.getByTestId('company-advanced-toggle').click();
    await page.getByTestId('company-tab-device').click();
    const trayPanel = page
      .getByTestId('company-tabpanel-device')
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /system tray|bandeja del sistema/i }) });
    await expect(trayPanel).toBeVisible();
    // Earlier backup operations intentionally produce success toasts. Clear
    // them before the focused evidence capture so the recovery action and
    // localized explanation are readable rather than visually obscured.
    const staleToastDismissals = page.getByRole('button', { name: /dismiss|descartar/i });
    while ((await staleToastDismissals.count()) > 0) {
      await staleToastDismissals.first().click();
    }
    await page.evaluate(() => window.api?.session?.clear());
    await trayPanel
      .getByRole('checkbox', { name: /show tray icon|mostrar ícono en la bandeja/i })
      .click();

    const sessionAlert = page
      .getByRole('alert')
      .filter({ hasText: /session is no longer active|sesión ya no está activa/i });
    await expect(sessionAlert).toBeVisible();
    await expect(sessionAlert).not.toContainText(
      /Error invoking remote method|SESSION_NOT_REGISTERED/
    );
    const reenter = sessionAlert.getByRole('button', {
      name: /sign in again|volver a iniciar sesión/i,
    });
    await expect(reenter).toBeVisible();
    await page.waitForTimeout(250);
    if (auditDir) {
      await page.screenshot({
        path: path.join(auditDir, 'electron-session-recovery-es.png'),
        fullPage: true,
      });
    }
    await reenter.click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await expect(page.getByLabel(/email|correo/i)).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
