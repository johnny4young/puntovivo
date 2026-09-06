import { expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ClientIssueTracker } from '../web/support/app.js';

/** A single synthetic transport failure injected before a real authority retry. */
export type BootstrapFault = {
  procedure: 'health.check' | 'auth.refresh' | 'auth.me';
  status: 429 | 503 | 'offline';
};

/** One deliberately failed transport boundary; the retry always reaches the real authority. */
export async function recoverBootstrap(
  page: Page,
  fault: BootstrapFault,
  locale: 'en' | 'es',
  evidenceLabel: string
) {
  const matches = (url: URL) =>
    url.pathname.split('/').at(-1)?.split(',').includes(fault.procedure) ?? false;
  let calls = 0;
  let injectedUrl = '';
  await page.route(matches, async route => {
    calls += 1;
    if (calls !== 1) return route.continue();
    injectedUrl = route.request().url();
    if (fault.status === 'offline') return route.abort('internetdisconnected');
    await route.fulfill({
      status: fault.status,
      headers: {
        'content-type': 'application/json',
        'retry-after': '2',
        'access-control-allow-origin':
          route.request().headers().origin ?? new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
        'access-control-expose-headers': 'Retry-After',
      },
      body: JSON.stringify(
        new URL(route.request().url()).pathname
          .split('/')
          .at(-1)!
          .split(',')
          .map(() => ({
            error: {
              code: fault.status === 429 ? -32029 : -32603,
              message: 'Injected private transport diagnostic',
              data: {
                code: fault.status === 429 ? 'TOO_MANY_REQUESTS' : 'INTERNAL_SERVER_ERROR',
                httpStatus: fault.status,
              },
            },
          }))
      ),
    });
  });
  const before = page.url();
  await page.reload();
  const title =
    fault.status === 429
      ? locale === 'es'
        ? 'Tu sesión necesita un momento'
        : 'Your session needs a moment'
      : locale === 'es'
        ? 'No pudimos verificar tu sesión'
        : 'We could not verify your session';
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toBeFocused();
  await expect(page.locator('#sales-product-search-input')).toBeHidden();
  await expect(page.locator('#email')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('Injected private transport diagnostic');
  expect(page.url()).toBe(before);
  const retry = page.getByRole('button', {
    name: locale === 'es' ? 'Reintentar conexión' : 'Retry connection',
    exact: true,
  });
  if (fault.status !== 'offline') await expect(retry).toBeDisabled();
  await expect(retry).toBeEnabled();
  // Waiting for the cooldown only updates the UI, never issues another request.
  expect(calls).toBe(1);
  const dir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (dir) {
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, `auth-recovery-${evidenceLabel}-${locale}.png`),
      fullPage: true,
    });
  }
  const response = page.waitForResponse(
    value => matches(new URL(value.url())) && value.status() === 200
  );
  await retry.click();
  await response;
  await expect(page.getByRole('heading', { name: title })).toBeHidden();
  expect(calls).toBe(2);
  // Keep the pass-through handler until this test's context closes. Removing
  // the last interception here can strand Chromium requests paused while the
  // newly authenticated route imports its modules (before the POS mounts).
  return injectedUrl;
}

/** Exempt only the single injected boundary, never page errors or unrelated API failures. */
export function expectOnlyInjectedBootstrapFailure(
  tracker: ClientIssueTracker,
  fault: BootstrapFault,
  injectedUrl: string
) {
  const issues = tracker.getIssues();
  const expectedNetwork =
    fault.status === 'offline'
      ? `requestfailed:net::ERR_INTERNET_DISCONNECTED ${injectedUrl}`
      : `response:${fault.status} ${injectedUrl}`;
  const expectedConsole =
    fault.status === 'offline'
      ? 'console:Failed to load resource: net::ERR_INTERNET_DISCONNECTED'
      : `console:Failed to load resource: the server responded with a status of ${fault.status}`;
  expect(issues.filter(issue => issue === expectedNetwork)).toHaveLength(1);
  expect(issues.filter(issue => issue.startsWith(expectedConsole)).length).toBeLessThanOrEqual(1);
  expect(
    issues.filter(issue => issue !== expectedNetwork && !issue.startsWith(expectedConsole))
  ).toEqual([]);
}
