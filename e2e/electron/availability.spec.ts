import { electronTest as test } from './fixtures.js';
import {
  runAvailabilityJourney,
  assertAvailabilityJourneyDiagnostics,
} from '../shared/availability-journey.js';
import { attachClientIssueTracker } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

test('availability constrains shifts and retains private history in embedded desktop', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');
  const result = await runAvailabilityJourney(page, {
    singleFrameAxe: true,
    navigate: route => goToRoute(page, route),
    signInManager: email => signIn(page, email),
    screenshot: async name => {
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    },
  });
  assertAvailabilityJourneyDiagnostics(tracker, result.conflictUrl);
});
