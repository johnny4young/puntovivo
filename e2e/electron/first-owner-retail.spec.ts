import path from 'node:path';
import { electronTest as test, ELECTRON_E2E_DB_KEY } from './fixtures.js';
import { runFirstOwnerRetailJourney } from '../shared/first-owner-retail-journey.js';
import { assertFirstOwnerRetailEvidence } from '../shared/first-owner-retail-evidence.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { requestRoute } from './support/journey.js';

test.use({ emptyInstallation: true, actionTimeout: 15_000 });
test('first real owner runs a retail store through UI and reconciles encrypted SQLite', async ({
  page,
  userDataDir,
}, info) => {
  test.setTimeout(180_000);
  const tracker = attachClientIssueTracker(page);
  await runFirstOwnerRetailJourney({
    page,
    language: 'es',
    goTo: route => requestRoute(page, route),
    screenshot: async name => {
      await page.screenshot({ path: info.outputPath(`${name}-desktop.png`), fullPage: true });
    },
  });
  await info.attach('sqlite-reconciliation', {
    body: JSON.stringify(
      assertFirstOwnerRetailEvidence(
        path.join(userDataDir, 'data', 'local.db'),
        ELECTRON_E2E_DB_KEY
      )
    ),
    contentType: 'application/json',
  });
  await expectNoClientIssues(tracker);
});
