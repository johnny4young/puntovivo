/**
 * The scale bridge is a real main-process capability: it must answer through
 * the sandboxed preload, keep settings to admins and managers, and never accept
 * a device path the operating system did not enumerate.
 */
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { electronTest as test, expect } from './fixtures.js';
import { goToRoute, signIn, signOut } from './support/journey.js';

const unlisted = {
  path: '/dev/puntovivo-not-a-port',
  protocol: 'toledo',
  baudRate: 9600,
  framing: '7E1',
} as const;

test('scale bridge answers through the preload and guards its settings', async ({ page }) => {
  const tracker = attachClientIssueTracker(page);
  await signIn(page, 'e2e.admin@local.test');

  const admin = await page.evaluate(async config => {
    const api = window.electron!;
    const settings = await api.getScaleSettings!();
    const save = await api.saveScaleSettings!(config);
    return {
      status: await api.getScaleStatus!(),
      read: await api.readScale!(),
      available: settings.available,
      portsIsList: Array.isArray(settings.ports),
      config: settings.config,
      save,
    };
  }, unlisted);
  expect(admin.status).toEqual({ configured: false });
  expect(admin.read).toEqual({ status: 'error', code: 'SCALE_NOT_CONFIGURED' });
  expect(admin.available).toBe(true);
  expect(admin.portsIsList).toBe(true);
  expect(admin.config).toBeNull();
  expect(admin.save).toEqual({ status: 'error', code: 'SCALE_PORT_UNAVAILABLE' });

  await goToRoute(page, '/peripherals');
  await expect(page.getByTestId('scale-settings')).toBeVisible();
  await expect(page.getByRole('group', { name: "This computer's scale" })).toBeVisible();

  await signOut(page);
  await signIn(page, 'e2e.cashier@local.test');
  const cashier = await page.evaluate(async () => {
    const api = window.electron!;
    return {
      read: await api.readScale!(),
      settings: await api.getScaleSettings!().then(
        () => 'allowed',
        (error: unknown) => String(error)
      ),
    };
  });
  expect(cashier.read).toEqual({ status: 'error', code: 'SCALE_NOT_CONFIGURED' });
  expect(cashier.settings).toContain('SESSION_ROLE_FORBIDDEN');
  await expectNoClientIssues(tracker);
});
