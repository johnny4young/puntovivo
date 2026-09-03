import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  COMPANION_E2E_USERS,
  expectNoClientIssues,
  login,
} from './support/app';

function isCompanionSnapshot(url: string): boolean {
  return url.includes('/api/trpc/companion.snapshot');
}

test('Companion is viewer-safe, honest offline and live after a signed close', async ({
  browser,
}, testInfo) => {
  const managerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const manager = await managerContext.newPage();
  const viewer = await viewerContext.newPage();
  const managerTracker = attachClientIssueTracker(manager);
  const viewerInitialTracker = attachClientIssueTracker(viewer);
  const requestedProcedures: string[] = [];
  viewer.on('request', request => {
    if (request.url().includes('/api/trpc/')) requestedProcedures.push(request.url());
  });

  try {
    await login(manager, COMPANION_E2E_USERS.manager, { entryPath: '/c/' });
    await expect(manager.getByTestId('companion-shell')).toBeVisible();
    await expect(manager.getByRole('heading', { name: 'How the day is going' })).toBeVisible();
    await expect(manager.getByTestId('companion-connection')).toContainText('Live');

    await login(viewer, COMPANION_E2E_USERS.viewer, { spanish: true, entryPath: '/c/' });
    await expect(viewer.getByRole('heading', { name: 'Cómo va el día' })).toBeVisible();
    await expect(viewer.getByTestId('companion-day-close-pending')).toBeVisible();
    await expect(viewer.getByTestId('companion-connection')).toContainText('En vivo');
    expect(requestedProcedures.some(isCompanionSnapshot)).toBe(true);
    expect(
      requestedProcedures.some(url =>
        ['dashboard.summary', 'operations.needsAttention', 'reports.dayClose'].some(procedure =>
          url.includes(procedure)
        )
      )
    ).toBe(false);
    await expectNoClientIssues(viewerInitialTracker);

    await viewerContext.setOffline(true);
    await expect(viewer.getByTestId('companion-offline')).toContainText('No tienes conexión');
    await expect(viewer.getByTestId('companion-revenue')).toHaveCount(0);
    await expect(viewer.getByTestId('companion-day-close-pending')).toHaveCount(0);

    const refreshedSnapshot = viewer.waitForResponse(response =>
      isCompanionSnapshot(response.url())
    );
    await viewerContext.setOffline(false);
    await refreshedSnapshot;
    await expect(viewer.getByTestId('companion-day-close-pending')).toBeVisible();
    await expect(viewer.getByTestId('companion-connection')).toContainText('En vivo');
    const viewerTracker = attachClientIssueTracker(viewer);

    await manager.goto('/day-close');
    await expect(manager.getByTestId('day-close-report-page')).toBeVisible();
    await expect(manager.getByTestId('day-close-readiness')).toContainText(
      /ready for manager review/i
    );
    await manager.getByRole('checkbox', { name: /I reviewed/i }).check();
    await manager.getByRole('button', { name: 'Sign day close' }).click();
    await manager.getByRole('button', { name: 'Sign and freeze' }).click();
    await expect(manager.getByTestId('day-close-signed-evidence')).toContainText(
      'E2E Companion Manager'
    );

    // The viewer was already connected before the manager signed. The
    // payload-free SSE invalidation must cause a fresh verified snapshot.
    await expect(viewer.getByTestId('companion-day-close-signed')).toContainText(
      'E2E Companion Manager',
      { timeout: 15_000 }
    );

    await viewer.getByTestId('companion-language').selectOption('en');
    await expect(viewer.getByRole('heading', { name: 'How the day is going' })).toBeVisible();
    await viewer.getByTestId('companion-language').selectOption('es');
    await expect(viewer.getByRole('heading', { name: 'Cómo va el día' })).toBeVisible();

    const screenshotPath = testInfo.outputPath('companion-mobile.png');
    await viewer.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('companion-mobile', { path: screenshotPath, contentType: 'image/png' });

    const snapshotsBeforeLogout = requestedProcedures.filter(isCompanionSnapshot).length;
    await viewer.getByTestId('companion-logout').click();
    await expect(viewer).toHaveURL(/\/login$/);
    const afterLogoutSnapshot = viewer.waitForResponse(response =>
      isCompanionSnapshot(response.url())
    );
    await login(viewer, COMPANION_E2E_USERS.viewer, { spanish: true, entryPath: '/c/' });
    await afterLogoutSnapshot;
    expect(requestedProcedures.filter(isCompanionSnapshot).length).toBeGreaterThan(
      snapshotsBeforeLogout
    );
    await expect(viewer.getByTestId('companion-day-close-signed')).toBeVisible();
    expect(
      requestedProcedures.some(url =>
        ['dashboard.summary', 'operations.needsAttention', 'reports.dayClose'].some(procedure =>
          url.includes(procedure)
        )
      )
    ).toBe(false);

    await expectNoClientIssues(managerTracker);
    await expectNoClientIssues(viewerTracker);
  } finally {
    await viewerContext.close();
    await managerContext.close();
  }
});
