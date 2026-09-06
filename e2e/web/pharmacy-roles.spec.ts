import { test } from '@playwright/test';
import { runPharmacyOtcCustodyJourney } from '../shared/pharmacy-operations-journey.js';
import { runPharmacyPrescriptionJourney } from '../shared/pharmacy-prescription-journey.js';
import { runPharmacyRolePrivacyJourney } from '../shared/pharmacy-role-journey.js';
import {
  attachClientIssueTracker,
  E2E_PASSWORD,
  expectNoClientIssues,
  login,
} from './support/app.js';
import { seedSurfaceGateScenario } from './support/db.js';

test.use({ actionTimeout: 15_000 });

test('pharmacy recall redacts customer identity for manager and excludes cashier', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const scenario = seedSurfaceGateScenario(
    `pharmacy-roles-${info.parallelIndex}-${Date.now()}`,
    {}
  );
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const target = {
    navigate: (route: string) => page.goto(route),
    screenshot: (name: string) =>
      page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
        animations: 'disabled' as const,
      }),
    configureNumbering: true,
    signInAs: (email: string) =>
      login(page, {
        email,
        password: E2E_PASSWORD,
        defaultPath: email.includes('.cashier.') ? '/sales' : '/dashboard',
      }),
    requestRestrictedRoute: () => page.goto('/inventory?view=pharmacy'),
  };
  const result = await runPharmacyOtcCustodyJourney(page, target);
  const prescription = await runPharmacyPrescriptionJourney(page, target, {
    ...result,
    approverEmail: scenario.admin.email,
  });
  await runPharmacyRolePrivacyJourney(page, target, prescription);
  expectNoClientIssues(tracker);
});
