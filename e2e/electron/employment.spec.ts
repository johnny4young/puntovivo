import { electronTest as test } from './fixtures.js';
import { runEmploymentJourney } from '../shared/employment-journey.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

test('employment lifecycle and manager privacy survive desktop reload', async ({ page }, info) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');
  await runEmploymentJourney(page, {
    singleFrameAxe: true,
    navigate: route => goToRoute(page, route),
    signInManager: email => signIn(page, email),
    screenshot: async name => {
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    },
  });
  await expectNoClientIssues(tracker);
});
