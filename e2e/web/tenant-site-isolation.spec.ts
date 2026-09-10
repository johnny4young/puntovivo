/**
 * Tenant-owned site selection across a login that replaces a resumed session.
 *
 * Opening /login keeps the refresh cookie, so boot resumes the previous
 * operator behind the form and caches its tenant-scoped reads under query keys
 * that carry no identity. Signing in to another tenant from that form must
 * never advertise or remember the previous tenant's site.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, loginAs } from './support/app';
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
