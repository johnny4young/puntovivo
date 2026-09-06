import { runInventoryIdentityCountJourney } from '../shared/inventory-identity-count-journey.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS } from '../shared/baseline.js';
import { electronTest as test } from './fixtures.js';
import { goToRoute, pinPrimarySite, signIn } from './support/journey.js';

test('exact lot and serial counts survive embedded Electron reload', async ({ page }, info) => {
  page.setDefaultTimeout(15_000);
  const tracker = attachClientIssueTracker(page);
  const admin = E2E_USERS.find(user => user.role === 'admin');
  if (!admin) throw new Error('The isolated desktop baseline must contain its admin');
  await signIn(page, admin.email);
  await pinPrimarySite(page);
  await runInventoryIdentityCountJourney(page, {
    navigate: route => goToRoute(page, route),
    configureNumbering: false,
    screenshot: name =>
      page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled',
      }),
  });
  expectNoClientIssues(tracker);
});
