import { test } from './support/empty-installation.js';
import { runFirstOwnerRetailJourney } from '../shared/first-owner-retail-journey.js';
import { assertFirstOwnerRetailEvidence } from '../shared/first-owner-retail-evidence.js';
import { attachClientIssueTracker, expectNoClientIssues } from './support/app.js';

test.use({ actionTimeout: 15_000 });

for (const language of ['en', 'es'] as const) {
  test(`a real first owner configures, imports, sells and reconciles an unseeded store (${language})`, async ({
    page,
    installation,
  }, info) => {
    test.setTimeout(180_000);
    await page.goto('/login');
    const tracker = attachClientIssueTracker(page);
    await runFirstOwnerRetailJourney({
      page,
      language,
      setupToken: installation.token,
      goTo: async route => {
        await page.goto(route);
      },
      screenshot: async name => {
        await page.screenshot({ path: info.outputPath(`${name}-${language}.png`), fullPage: true });
      },
    });
    await info.attach('sqlite-reconciliation', {
      body: JSON.stringify(assertFirstOwnerRetailEvidence(installation.databasePath)),
      contentType: 'application/json',
    });
    await expectNoClientIssues(tracker);
  });
}
