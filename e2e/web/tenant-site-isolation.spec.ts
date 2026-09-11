/**
 * Site selection stays owned by the tenant and the tab that resolved it.
 *
 * - Opening /login keeps the refresh cookie, so boot resumes the previous
 *   operator behind the form and caches its tenant-scoped reads under query
 *   keys that carry no identity. Signing in to another tenant from that form
 *   must never advertise or remember the previous tenant's site.
 * - Every same-origin tab shares localStorage, which only remembers the last
 *   selection. A tab must keep sending the site it shows after another tab
 *   switches.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login, loginAs } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

async function captureEvidence(page: Page, name: string, locator?: Locator) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  const options = {
    animations: 'disabled' as const,
    path: path.join(auditDir, `${name}.png`),
  };
  if (locator) {
    await locator.screenshot(options);
    return;
  }
  await page.screenshot({ ...options, fullPage: true });
}

async function switchToSite(page: Page, target: { id: string; name: string }, tenantId: string) {
  const trigger = page.locator('header button[name="site"]');
  await trigger.click();
  await page.getByRole('option', { name: target.name, exact: true }).click();
  await expect(trigger).toHaveText(target.name);
  await expect
    .poll(() =>
      page.evaluate(key => window.localStorage.getItem(key), `active_site_id:${tenantId}`)
    )
    .toBe(target.id);
}

test('a login over a resumed session never inherits the previous tenant site', async ({
  page,
}, testInfo) => {
  const nextTenant = seedSurfaceGateScenario(
    `tenant-site-isolation-${testInfo.parallelIndex}-${Date.now()}`,
    {}
  );
  const tracker = attachClientIssueTracker(page);
  const header = page.locator('header').first();
  const siteTrigger = header.locator('button[name="site"]');

  await loginAs(page, 'admin');
  await expect(siteTrigger).toBeEnabled();
  await captureEvidence(page, '01-previous-tenant-site', header);

  // Mirror the reported sequence: drop local selections, then reopen /login.
  // The refresh cookie resumes the previous tenant and caches its site list.
  await page.evaluate(() => window.localStorage.clear());
  const resumedSites = page.waitForResponse(
    response => response.url().includes('sites.list') && response.ok()
  );
  await page.goto('/login');
  await resumedSites;

  await page.locator('#email').fill(nextTenant.admin.email);
  await page.locator('#password').fill(nextTenant.admin.password);
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page).toHaveURL(/\/company(?:$|\?)/, { timeout: 30_000 });

  await expect(siteTrigger).toHaveText(nextTenant.site.name);
  await expect
    .poll(() =>
      page.evaluate(
        key => window.localStorage.getItem(key),
        `active_site_id:${nextTenant.tenantId}`
      )
    )
    .toBe(nextTenant.site.id);
  await captureEvidence(page, '02-next-tenant-site', header);
  await expectNoClientIssues(tracker);
});

test('each tab keeps sending the site it shows after another tab switches', async ({
  page,
}, testInfo) => {
  const tenant = seedSurfaceGateScenario(
    `tab-site-isolation-${testInfo.parallelIndex}-${Date.now()}`,
    {}
  );
  const secondSite = { id: `${tenant.site.id}-second`, name: 'Second surface site' };
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
  try {
    db.pragma('busy_timeout = 15000');
    db.prepare(
      'INSERT INTO sites (id, tenant_id, company_id, name, is_active, created_at, updated_at) SELECT ?, tenant_id, company_id, ?, 1, created_at, updated_at FROM sites WHERE id = ? AND tenant_id = ?'
    ).run(secondSite.id, secondSite.name, tenant.site.id, tenant.tenantId);
  } finally {
    db.close();
  }
  // The seeded tenant resolves to Spanish; pin English so role names stay stable.
  await page
    .context()
    .addInitScript(() => window.localStorage.setItem('puntovivo-language-preference', 'en'));

  const firstTab = page;
  const firstTracker = attachClientIssueTracker(firstTab);
  await login(firstTab, { ...tenant.admin, defaultPath: '/company' });
  await switchToSite(firstTab, secondSite, tenant.tenantId);

  const secondTab = await page.context().newPage();
  const secondTracker = attachClientIssueTracker(secondTab);
  await secondTab.goto('/company');
  await expect(secondTab.locator('header button[name="site"]')).toHaveText(secondSite.name);
  await switchToSite(secondTab, tenant.site, tenant.tenantId);
  await captureEvidence(secondTab, '03-second-tab-switched', secondTab.locator('header').first());

  // The first tab never switched again: it still shows, and must still send, its own site.
  await expect(firstTab.locator('header button[name="site"]')).toHaveText(secondSite.name);
  const nextRequest = firstTab.waitForRequest(request => request.url().includes('/api/trpc/'));
  await firstTab.getByRole('link', { name: 'Make a sale' }).first().click();
  expect((await nextRequest).headers()['x-site-id']).toBe(secondSite.id);
  await captureEvidence(firstTab, '04-first-tab-keeps-site', firstTab.locator('header').first());

  await expectNoClientIssues(firstTracker);
  await expectNoClientIssues(secondTracker);
});
