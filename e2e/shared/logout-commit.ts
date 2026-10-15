import { expect, type Page } from '@playwright/test';

/** Observe the real logout transaction without assuming browser custody on desktop. */
export async function prepareLogoutCommit(page: Page): Promise<() => Promise<void>> {
  const native = await page.evaluate(async () => {
    type Session = {
      localAuth?: unknown;
      resume: () => Promise<{ token: string | null }>;
    };
    const host = window as unknown as {
      api?: { session?: Session };
      session?: Session;
      electron?: {
        runtime?: {
          getConfigSync?: () => {
            authorityMode: string;
            localApiUrl: string | null;
          };
        };
      };
    };
    const session = host.api?.session ?? host.session;
    const config = host.electron?.runtime?.getConfigSync?.();
    if (!session?.localAuth || config?.authorityMode === 'hub_client') return null;
    const { token } = await session.resume();
    if (!token || !config?.localApiUrl)
      throw new Error('Native logout requires a verified access token and configured authority');
    return { token, apiUrl: config.localApiUrl };
  });

  if (!native) {
    const response = page.waitForResponse(
      candidate =>
        candidate.request().method() === 'POST' &&
        candidate.url().includes('/api/trpc/auth.logout') &&
        candidate.status() !== 401
    );
    return async () => {
      expect(
        (await response).status(),
        'the server logout must commit before changing actors'
      ).toBe(200);
    };
  }

  const headers = { authorization: `Bearer ${native.token}` };
  const url = `${native.apiUrl}/api/trpc/auth.me`;
  expect(
    (await page.request.get(url, { headers })).status(),
    'the pre-logout access token must be valid'
  ).toBe(200);
  return async () => {
    await expect(page).toHaveURL(/\/login$/);
    // A cleared renderer/main cache alone cannot satisfy this: the same token
    // must be rejected by the authority after the operator's real logout.
    expect(
      (await page.request.get(url, { headers })).status(),
      'logout must revoke the previously valid server session'
    ).toBe(401);
    const resumed = await page.evaluate(async () => {
      const host = window as unknown as {
        api?: { session?: { resume: () => Promise<{ token: string | null }> } };
        session?: { resume: () => Promise<{ token: string | null }> };
      };
      return (host.api?.session ?? host.session)?.resume();
    });
    expect(resumed?.token, 'logout must also clear desktop custody').toBeNull();
  };
}
