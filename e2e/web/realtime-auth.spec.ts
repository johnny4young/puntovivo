import { expect, test, type Page } from '@playwright/test';
import { login } from './support/app';
import { seedAuthUser } from './support/db';

const API_ORIGIN = 'http://localhost:8090';

async function realtimeClientCount(page: Page, bearer: string): Promise<number> {
  const response = await page.request.get(`${API_ORIGIN}/api/realtime/status`, {
    headers: { authorization: bearer },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { clients: number }).clients;
}

/**
 * Mint a Bearer for the status endpoint, which is authenticated and
 * tenant-scoped. The renderer keeps its own access token in memory, so the
 * spec asks the API for one rather than reaching into the app.
 */
async function bearerFor(page: Page, user: { email: string; password: string }): Promise<string> {
  const response = await page.request.post(`${API_ORIGIN}/api/trpc/auth.login?batch=1`, {
    headers: { 'content-type': 'application/json' },
    data: { 0: { email: user.email, password: user.password } },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as [{ result: { data: { token: string } } }];
  return `Bearer ${body[0].result.data.token}`;
}

test.describe('authenticated realtime continuity', () => {
  test('uses Bearer SSE and routes to login after session revocation', async ({
    page,
  }, testInfo) => {
    const isolatedAdmin = seedAuthUser(
      `realtime-auth-${testInfo.parallelIndex}-${Date.now()}`,
      'admin'
    );
    // A SECOND operator of the same tenant owns the status bearer: the
    // test logs the first one out, and the count must stay observable
    // across that revocation. Same tenant, so the scoped count still sees
    // the stream under test.
    const statusObserver = seedAuthUser(
      `realtime-status-${testInfo.parallelIndex}-${Date.now()}`,
      'admin'
    );
    await login(page, { ...isolatedAdmin, defaultPath: '/dashboard' });
    const statusBearer = await bearerFor(page, statusObserver);
    const baselineClients = await realtimeClientCount(page, statusBearer);
    const subscribeRequest = page.waitForRequest(
      request => request.url().includes('/api/realtime/subscribe?collections=kds'),
      { timeout: 15_000 }
    );

    await page.goto('/kds');
    await expect(page.getByTestId('kds-shell')).toBeVisible();
    const request = await subscribeRequest;
    const authorization = request.headers()['authorization'];
    expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    if (!authorization) throw new Error('Expected realtime Authorization header');
    await expect
      .poll(() => realtimeClientCount(page, statusBearer), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(baselineClients + 1);

    const csrfCookie = (await page.context().cookies()).find(
      cookie => cookie.name === 'puntovivo_csrf'
    );
    const logout = await page.request.post(`${API_ORIGIN}/api/trpc/auth.logout?batch=1`, {
      headers: {
        authorization,
        'content-type': 'application/json',
        ...(csrfCookie ? { 'x-csrf-token': csrfCookie.value } : {}),
      },
      data: {},
    });
    expect(logout.ok()).toBe(true);

    // The server revalidates sessionVersion on its 30-second heartbeat. Once
    // the revoked stream closes, the bounded reconnect exhausts refresh and
    // the canonical AuthProvider session-expired path owns the redirect.
    await expect(page).toHaveURL(/\/login(?:$|\?)/, { timeout: 45_000 });
    await expect
      .poll(() => realtimeClientCount(page, statusBearer), { timeout: 10_000 })
      .toBe(baselineClients);
  });
});
