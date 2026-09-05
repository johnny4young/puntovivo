import { electronTest as test } from './fixtures.js';
import {
  assertShiftSwapJourneyDiagnostics,
  runShiftSwapJourney,
} from '../shared/shift-swap-journey.js';
import { attachClientIssueTracker } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

test('three actors exchange exact published shifts through the embedded backend', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');
  await runShiftSwapJourney(page, {
    singleFrameAxe: true,
    navigate: route => goToRoute(page, route),
    signIn: email => signIn(page, email),
    signInAdmin: () => signIn(page, 'e2e.admin@local.test'),
    screenshot: name => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true }),
  });
  assertShiftSwapJourneyDiagnostics(tracker);
});
