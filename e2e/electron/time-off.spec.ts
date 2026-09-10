import { electronTest as test } from './fixtures.js';
import { runTimeOffJourney } from '../shared/time-off-journey.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { goToRoute, signIn } from './support/journey.js';

test('absence decisions and original approval survive embedded desktop reload', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');
  await runTimeOffJourney(page, {
    singleFrameAxe: true,
    navigate: route => goToRoute(page, route),
    signInManager: email => signIn(page, email),
    screenshot: async name => {
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    },
  });
  await expectNoClientIssues(tracker);
});
