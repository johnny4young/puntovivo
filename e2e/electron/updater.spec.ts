import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  createIsolatedUserDataDir,
  electronTest as test,
  expect,
  IS_PACKAGED_RUN,
  launchUpdaterSmokeElectron,
} from './fixtures.js';
import { attachClientIssueTracker, E2E_USERS, expectNoClientIssues } from '../web/support/app.js';

async function login(page: Page) {
  const admin = E2E_USERS.admin;
  await page.getByLabel(/email/i).fill(admin.email);
  await page.getByRole('textbox', { name: /password/i }).fill(admin.password);
  await page.getByRole('button', { name: /enter workspace|entrar al espacio de trabajo/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe('desktop updater persistence', () => {
  test.skip(IS_PACKAGED_RUN, 'the hermetic updater double is never enabled in packaged evidence');

  test('reconfirms persisted downloads and rejects a regressive feed', async () => {
    const userDataDir = createIsolatedUserDataDir('updater persistence');
    const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
    let first: Awaited<ReturnType<typeof launchUpdaterSmokeElectron>> | null = null;
    let second: Awaited<ReturnType<typeof launchUpdaterSmokeElectron>> | null = null;
    try {
      first = await launchUpdaterSmokeElectron(userDataDir);
      const firstTracker = attachClientIssueTracker(first.page);
      await first.page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem('puntovivo-language-preference', 'en');
      });
      await first.page.reload();
      await login(first.page);
      const initialStatus = await first.page.evaluate(() => window.electron?.getAutoUpdateStatus());
      if (!initialStatus) throw new Error('initial updater status unavailable');
      const [major = 1, minor = 0, patch = 0] = initialStatus.currentVersion.split('.').map(Number);
      const candidateVersion = `${major}.${minor}.${patch + 1}`;
      await first.page.evaluate(async version => {
        if (!window.electron?.simulateDownloadedAppUpdateForE2e) {
          throw new Error('updater E2E bridge unavailable');
        }
        await window.electron.simulateDownloadedAppUpdateForE2e(version);
      }, candidateVersion);
      await first.page.reload();
      await expect(first.page.getByTestId('auto-update-banner')).toContainText(
        `Puntovivo ${candidateVersion} is ready to install`
      );
      expectNoClientIssues(firstTracker);
      await first.dispose();
      first = null;

      second = await launchUpdaterSmokeElectron(userDataDir);
      const secondTracker = attachClientIssueTracker(second.page);
      await expect(second.page).toHaveURL(/\/login/, { timeout: 30_000 });
      await login(second.page);
      const persisted = await second.page.evaluate(() => window.electron?.getAutoUpdateStatus());
      expect(persisted).toMatchObject({
        state: 'downloaded',
        downloadedVersion: candidateVersion,
        installReady: false,
        updateFloorVersion: initialStatus.currentVersion,
      });
      const banner = second.page.getByTestId('auto-update-banner');
      await expect(banner).toContainText(`Puntovivo ${candidateVersion} was downloaded previously`);
      await expect(banner.getByRole('button', { name: /restart to install/i })).toHaveCount(0);

      const candidatePolicy = await second.page.evaluate(async candidate => {
        const evaluate = window.electron?.evaluateAppUpdateCandidateForE2e;
        if (!evaluate) throw new Error('candidate E2E bridge unavailable');
        return {
          regressiveNormal: await evaluate('0.1.0', 'normal'),
          remoteRollback: await evaluate(candidate, 'rollback'),
        };
      }, candidateVersion);
      expect(candidatePolicy).toEqual({ regressiveNormal: false, remoteRollback: false });

      await banner.getByRole('button', { name: /verify download/i }).click();
      await expect(banner.getByRole('button', { name: /restart to install/i })).toBeEnabled();
      if (auditDir) {
        await mkdir(auditDir, { recursive: true });
        await second.page.screenshot({
          path: path.join(auditDir, 'electron-updater-ready.png'),
          fullPage: true,
        });
      }
      await banner.getByRole('button', { name: /restart to install/i }).click();
      await expect
        .poll(() =>
          second?.page.evaluate(() => window.electron?.wasAppUpdateRestartRequestedForE2e?.())
        )
        .toBe(true);
      expectNoClientIssues(secondTracker);
    } finally {
      await second?.dispose();
      await first?.dispose();
      await rm(userDataDir, { recursive: true, force: true });
    }
  });
});
