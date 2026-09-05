import { electronTest as test } from './fixtures.js';
import { assertPayrollJourneyDiagnostics, runPayrollJourney } from '../shared/payroll-journey.js';
import { attachClientIssueTracker } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

test('persists Colombia pre-payroll through the sandboxed renderer and embedded backend', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');
  await runPayrollJourney(page, {
    singleFrameAxe: true,
    navigate: route => goToRoute(page, route),
    screenshot: name => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true }),
  });
  assertPayrollJourneyDiagnostics(tracker);
});
