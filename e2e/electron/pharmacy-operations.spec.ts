/** Pharmacy custody through the real embedded server and encrypted desktop DB. */
import {
  runPharmacyOtcCustodyJourney,
  type PharmacyJourneyTarget,
} from '../shared/pharmacy-operations-journey.js';
import { runPharmacyPrescriptionJourney } from '../shared/pharmacy-prescription-journey.js';
import { runPharmacyRecallReturnJourney } from '../shared/pharmacy-recall-journey.js';
import { runPharmacyExpiryPolicyJourney } from '../shared/pharmacy-expiry-policy-journey.js';
import { expectOnlyVerifiedPharmacyRejections } from '../shared/pharmacy-rejection-assertions.js';
import { attachClientIssueTracker } from '../web/support/app.js';
import { electronTest as test } from './fixtures.js';
import { goToRoute, pinPrimarySite, signIn } from './support/journey.js';
import { E2E_USERS } from '../shared/baseline.js';

test.use({ actionTimeout: 15_000 });

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  await page.screenshot({ path: info.outputPath('pharmacy-failure.png'), fullPage: true });
  await info.attach('pharmacy-visible-state', {
    body: await page.locator('body').ariaSnapshot(),
    contentType: 'text/plain',
  });
});

test('pharmacy custody and once-only prescription dispensing survive Electron reload', async ({
  page,
}, info) => {
  page.setDefaultTimeout(15_000);
  const tracker = attachClientIssueTracker(page);
  const admin = E2E_USERS.find(user => user.role === 'admin');
  if (!admin) throw new Error('The isolated desktop baseline must contain its admin');
  await signIn(page, admin.email);
  await pinPrimarySite(page);
  const target: PharmacyJourneyTarget = {
    navigate: route => goToRoute(page, route),
    screenshot: name =>
      page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled',
      }),
    configureNumbering: false,
  };
  const result = await runPharmacyOtcCustodyJourney(page, target);
  const prescription = await runPharmacyPrescriptionJourney(page, target, {
    ...result,
    approverEmail: admin.email,
  });
  await runPharmacyRecallReturnJourney(page, target, result);
  const expiry = await runPharmacyExpiryPolicyJourney(page, target, {
    ...result,
    prescription: prescription.medicine,
    controlled: prescription.controlled,
    customerName: prescription.customerName,
  });
  expectOnlyVerifiedPharmacyRejections(tracker, expiry.rejections);
});
