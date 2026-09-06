import { runPharmacyOtcCustodyJourney } from '../shared/pharmacy-operations-journey.js';
import { runPharmacyTransferReturnJourney } from '../shared/pharmacy-transfer-journey.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS } from '../shared/baseline.js';
import { electronTest as test } from './fixtures.js';
import { goToRoute, pinPrimarySite, signIn } from './support/journey.js';

test('pharmacy exact-lot transfers and supplier returns survive Electron reload', async ({
  page,
}, info) => {
  page.setDefaultTimeout(15_000);
  const tracker = attachClientIssueTracker(page);
  const admin = E2E_USERS.find(user => user.role === 'admin');
  if (!admin) throw new Error('The isolated desktop baseline must contain its admin');
  await signIn(page, admin.email);
  await pinPrimarySite(page);
  const target = {
    navigate: (route: string) => goToRoute(page, route),
    screenshot: (name: string) =>
      page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled' as const,
      }),
    configureNumbering: false,
  };
  const result = await runPharmacyOtcCustodyJourney(page, target);
  await runPharmacyTransferReturnJourney(page, target, result);
  expectNoClientIssues(tracker);
});
