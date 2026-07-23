import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './support/app';

const API_ORIGIN = 'http://localhost:8090';

async function realtimeClientCount(page: Page): Promise<number> {
  const response = await page.request.get(`${API_ORIGIN}/api/realtime/status`);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { clients: number }).clients;
}

test.describe('authenticated realtime continuity', () => {
  test('uses Bearer SSE and routes to login after session revocation', async ({ page }) => {
    await loginAs(page, 'admin');
    const baselineClients = await realtimeClientCount(page);
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
      .poll(() => realtimeClientCount(page), { timeout: 10_000 })
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
    await expect.poll(() => realtimeClientCount(page), { timeout: 10_000 }).toBe(baselineClients);
  });
});
