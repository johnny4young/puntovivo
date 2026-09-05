import { electronTest as test } from './fixtures.js';
import {
  assertAttendanceReconciliationJourneyDiagnostics,
  runAttendanceReconciliationJourney,
} from '../shared/attendance-reconciliation-journey.js';
import { attachClientIssueTracker } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

test('reconciles signed attendance and no-shows through the embedded backend', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');
  await runAttendanceReconciliationJourney(page, {
    singleFrameAxe: true,
    navigate: route => goToRoute(page, route),
    signIn: email => signIn(page, email),
    signInAdmin: () => signIn(page, 'e2e.admin@local.test'),
    signInManager: email => signIn(page, email),
    screenshot: name => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true }),
  });
  assertAttendanceReconciliationJourneyDiagnostics(tracker);
});
