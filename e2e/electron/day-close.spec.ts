/**
 * The `day-close` operator journey, run against the desktop app.
 *
 * A manager reviews one business day, explicitly attests to it, confirms the
 * irreversible action, and then reloads the renderer to prove the signed
 * snapshot survives outside React state. The stored PDF is downloaded through
 * the same embedded-server route the shipped renderer uses.
 *
 * The fixture gives every test a fresh copy of the seeded SQLCipher database,
 * so the fixed historical date is unsigned on the first attempt without
 * reaching into the packaged application's private data directory.
 *
 * @module e2e/electron/day-close
 */

import { electronTest as test, expect } from './fixtures.js';
import { E2E_USERS } from '../shared/baseline.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

const BUSINESS_DAY = '2000-01-01';

test.describe('day close on the desktop app', () => {
  test('manager signs and reloads immutable day-close evidence', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    const manager = E2E_USERS.find(user => user.role === 'manager');
    expect(Boolean(manager), 'baseline seeds a manager').toBe(true);

    await signIn(page, manager!.email);
    await goToRoute(page, '/day-close');

    const dateInput = page.getByLabel(/^(Business day|Día comercial)$/i);
    await expect(dateInput).toBeVisible({ timeout: 30_000 });
    await dateInput.fill(BUSINESS_DAY);

    const unsignedCard = page.getByTestId('day-close-signoff-card');
    await expect(unsignedCard).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('day-close-readiness')).toContainText(
      /ready for manager review|listo para revisión/i
    );

    await unsignedCard.getByRole('checkbox', { name: /I reviewed|Revisé/i }).check();
    await unsignedCard
      .getByRole('button', { name: /Sign day close|Firmar cierre/i })
      .click();

    const confirmation = page.getByRole('dialog');
    await expect(confirmation).toContainText(/irreversible/i);
    await confirmation
      .getByRole('button', { name: /Sign and freeze|Firmar y proteger/i })
      .click();

    const evidence = page.getByTestId('day-close-signed-evidence');
    await expect(evidence).toContainText(manager!.name);
    await expect(page.getByTestId('day-close-signoff-hash')).toHaveText(/^[a-f0-9]{64}$/);
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    // Electron does not surface a Playwright download event for the renderer's
    // transient blob anchor. The success toast is emitted only after the
    // protected artifact response passes MIME, byte-size, and SHA-256 checks
    // and downloadFile has been invoked, so it is the product-level contract.
    await page.getByTestId('day-close-pdf-download').click();
    await expect(
      page.getByRole('status').filter({ hasText: /Signed PDF downloaded|PDF firmado descargado/i })
    ).toBeVisible();

    await page.reload();
    // A renderer reload intentionally starts a fresh in-memory auth client.
    // Re-authenticate through the public form instead of preserving privileged
    // state in the fixture, then prove the signed database evidence survives.
    await signIn(page, manager!.email);
    await goToRoute(page, '/day-close');
    await expect(dateInput).toBeVisible({ timeout: 30_000 });
    await dateInput.fill(BUSINESS_DAY);
    await expect(evidence).toContainText(manager!.name);
    await expect(page.getByTestId('day-close-signoff-hash')).toHaveText(/^[a-f0-9]{64}$/);
    await expect(page.getByTestId('day-close-pdf-download')).toBeEnabled();
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    await expectNoClientIssues(tracker);
  });
});
