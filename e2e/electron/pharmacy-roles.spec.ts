import { runPharmacyOtcCustodyJourney } from '../shared/pharmacy-operations-journey.js';
import { runPharmacyPrescriptionJourney } from '../shared/pharmacy-prescription-journey.js';
import { runPharmacyRolePrivacyJourney } from '../shared/pharmacy-role-journey.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { E2E_USERS } from '../shared/baseline.js';
import { electronTest as test } from './fixtures.js';
import { goToRoute, pinPrimarySite, requestRoute, signIn } from './support/journey.js';

test('pharmacy private recall state does not survive manager and cashier handoffs in Electron', async ({
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
    signInAs: (email: string) => signIn(page, email),
    requestRestrictedRoute: () => requestRoute(page, '/inventory?view=pharmacy'),
  };
  const result = await runPharmacyOtcCustodyJourney(page, target);
  const prescription = await runPharmacyPrescriptionJourney(page, target, {
    ...result,
    approverEmail: admin.email,
  });
  await runPharmacyRolePrivacyJourney(page, target, prescription);
  expectNoClientIssues(tracker);
});
