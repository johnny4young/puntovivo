import { expect, test, type Request } from '@playwright/test';
import { login } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

for (const session of [
  'anonymous',
  'stale',
  'valid',
  'malformed-csrf',
  'malformed-percent-csrf',
] as const) {
  test(`initializes CSRF before first-paint telemetry with ${session} cookies`, async ({
    page,
    context,
  }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('puntovivo-language-preference', 'en'));
    if (session === 'valid') {
      const fixture = seedSurfaceGateScenario(`rum-${Date.now()}-${testInfo.parallelIndex}`, {});
      await login(page, { ...fixture.admin, defaultPath: '/company' });
      expect((await context.cookies()).some(cookie => cookie.name === 'puntovivo_refresh')).toBe(
        true
      );
      await page.goto('about:blank');
      await context.clearCookies({ name: 'puntovivo_csrf' });
    } else {
      await context.clearCookies();
      if (session !== 'anonymous') {
        await context.addCookies([
          {
            name: 'puntovivo_refresh',
            value: 'synthetic-expired-refresh',
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            sameSite: 'Strict',
          },
        ]);
      }
      if (session === 'malformed-csrf' || session === 'malformed-percent-csrf') {
        await context.addCookies([
          {
            name: 'puntovivo_csrf',
            value: session === 'malformed-percent-csrf' ? '%' : 'invalid',
            domain: 'localhost',
            path: '/',
          },
        ]);
      }
    }

    const requestsBeforeHealth: string[] = [];
    const setupRequestsBeforeHealth: string[] = [];
    const telemetryRequests: Request[] = [];
    const forbidden: string[] = [];
    const telemetryResults: unknown[] = [];
    let healthFinished = false;
    let releaseHealth!: () => void;
    const heldHealth = new Promise<void>(resolve => {
      releaseHealth = resolve;
    });
    await page.route('**/api/trpc/health.check**', async route => {
      await heldHealth;
      await route.continue();
    });
    page.on('request', request => {
      if (!healthFinished && request.url().includes('/api/trpc/auth.setupStatus')) {
        setupRequestsBeforeHealth.push(new URL(request.url()).pathname);
      }
      if (request.url().includes('observability.reportWebVital')) {
        telemetryRequests.push(request);
      }
      if (!healthFinished && request.method() === 'POST') {
        requestsBeforeHealth.push(new URL(request.url()).pathname);
      }
    });
    page.on('response', async response => {
      if (response.url().includes('/api/trpc/health.check')) healthFinished = true;
      if (response.status() === 403) forbidden.push(new URL(response.url()).pathname);
      if (response.url().includes('observability.reportWebVital')) {
        const procedures = new URL(response.url()).pathname.split('/api/trpc/')[1]!.split(',');
        try {
          const body = await response.json();
          for (const [index, procedure] of procedures.entries()) {
            if (procedure === 'observability.reportWebVital') telemetryResults.push(body[index]);
          }
        } catch {
          telemetryResults.push({ error: 'invalid telemetry response' });
        }
      }
    });
    const healthRequested = page.waitForRequest('**/api/trpc/health.check**');
    try {
      await page.goto(session === 'valid' ? '/company' : '/login');
      await healthRequested;
      await page.waitForFunction(() => performance.getEntriesByType('paint').length > 0);
      await page.evaluate(
        () =>
          new Promise<void>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      if (session !== 'valid') {
        // The mounted form starts its query, but that query must still wait for health.
        await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
      }
      expect(setupRequestsBeforeHealth).toEqual([]);
      expect(requestsBeforeHealth).toEqual([]);
    } finally {
      releaseHealth();
    }
    await expect.poll(() => telemetryResults.length).toBeGreaterThan(0);
    // The same batch may include the expected anonymous refresh 401 and
    // therefore return HTTP 207. Verify each telemetry operation, not a
    // misleading transport-wide status that also represents authentication.
    for (const result of telemetryResults) {
      expect(result).toMatchObject({ result: { data: { accepted: expect.any(Boolean) } } });
      expect(result).not.toHaveProperty('error');
    }
    // Public RUM uses only explicit bearer authority when present. A browser
    // Cookie on this path would recreate the login-transition CSRF race.
    for (const request of telemetryRequests) {
      const headers = await request.allHeaders();
      expect(headers.cookie).toBeUndefined();
      expect(headers['x-csrf-token']).toBeUndefined();
    }
    if (session === 'valid') {
      await expect(page.locator('header').first()).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    } else {
      await expect(page.getByRole('button', { name: 'Enter workspace' })).toBeVisible();
      expect((await context.cookies()).some(cookie => cookie.name === 'puntovivo_refresh')).toBe(
        false
      );
    }
    expect(forbidden).toEqual([]);
  });
}
