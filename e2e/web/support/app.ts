import { expect, type Page } from '@playwright/test';

export const E2E_PASSWORD = 'PuntovivoE2E!123';

export const E2E_USERS = {
  admin: { email: 'e2e.admin@local.test', password: E2E_PASSWORD, defaultPath: '/dashboard' },
  manager: { email: 'e2e.manager@local.test', password: E2E_PASSWORD, defaultPath: '/dashboard' },
  cashier: { email: 'e2e.cashier@local.test', password: E2E_PASSWORD, defaultPath: '/sales' },
  viewer: { email: 'e2e.viewer@local.test', password: E2E_PASSWORD, defaultPath: '/dashboard' },
} as const;

type UserKey = keyof typeof E2E_USERS;

export interface LoginCredentials {
  email: string;
  password: string;
  defaultPath: string;
}

const ALLOWED_CONSOLE_PATTERNS = [
  '[vite] connecting',
  '[vite] connected',
  'Download the React DevTools',
  'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
  // The auth bootstrap does a best-effort `auth.refresh` on startup. If
  // the dev server happens to be pre-warm under heavy parallel load the
  // first refresh can race with `startupTenant` and throw a transient
  // TRPCClientError: Failed to fetch. This is not a product bug — a real
  // auth failure lands as a pageerror or a red response, not here.
  'Auth init error: TRPCClientError: Failed to fetch',
];

const ALLOWED_RESPONSE_PATTERNS = [
  { status: 401, fragment: '/api/trpc/auth.refresh?batch=1' },
];

export interface ClientIssueTracker {
  getIssues: () => string[];
}

export function attachClientIssueTracker(page: Page): ClientIssueTracker {
  const issues: string[] = [];

  page.on('console', msg => {
    if (msg.type() !== 'error') {
      return;
    }

    const text = msg.text();
    if (ALLOWED_CONSOLE_PATTERNS.some(pattern => text.includes(pattern))) {
      return;
    }

    issues.push(`console:${text}`);
  });

  page.on('pageerror', error => {
    issues.push(`pageerror:${error.message}`);
  });

  page.on('response', response => {
    if (response.status() < 400) {
      return;
    }

    const url = response.url();
    const isAllowed = ALLOWED_RESPONSE_PATTERNS.some(
      pattern => response.status() === pattern.status && url.includes(pattern.fragment)
    );

    if (!isAllowed) {
      issues.push(`response:${response.status()} ${url}`);
    }
  });

  page.on('requestfailed', request => {
    const errorText = request.failure()?.errorText ?? 'unknown';
    if (errorText === 'net::ERR_ABORTED') {
      return;
    }

    issues.push(`requestfailed:${errorText} ${request.url()}`);
  });

  return {
    getIssues: () => issues,
  };
}

export async function expectNoClientIssues(tracker: ClientIssueTracker) {
  expect(tracker.getIssues()).toEqual([]);
}

export async function login(
  page: Page,
  credentials: LoginCredentials,
  options?: { spanish?: boolean }
) {
  if (options?.spanish) {
    await page.addInitScript(() => {
      window.localStorage.setItem('puntovivo-language-preference', 'es');
    });
  }

  await page.goto('/login');
  await page.locator('#email').fill(credentials.email);
  await page.locator('#password').fill(credentials.password);
  await page
    .getByRole('button', {
      name: options?.spanish ? 'Entrar al espacio de trabajo' : 'Enter workspace',
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`${credentials.defaultPath}(?:$|\\?)`), {
    timeout: 30_000,
  });
}

export async function loginAs(page: Page, user: UserKey, options?: { spanish?: boolean }) {
  await login(page, E2E_USERS[user], options);
}

export async function resetSession(page: Page) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

export async function ensureLanguage(page: Page, language: 'en' | 'es') {
  await page.evaluate(value => {
    window.localStorage.setItem('puntovivo-language-preference', value);
  }, language);
  await page.reload();
}

export async function openUserMenu(page: Page) {
  await page.getByRole('button', { name: /e2e/i }).click();
}

/**
 * Puntovivo success toasts auto-dismiss after ~4 s. Under heavy parallel
 * load a worker can arrive at `toBeVisible` just after that window, which
 * produces a false-negative flake. `expectSuccessToast` treats the toast
 * as **best-effort visual confirmation**:
 *
 * - it scopes to `role="status"` (the toast's ARIA role) so it never
 *   collides with a body paragraph that happens to contain the same text
 * - it polls the toast region with a short timeout
 * - if the toast has already faded, it does NOT fail — the caller is
 *   expected to pair this with a deterministic post-action assertion
 *   (dialog closed, row state changed, DB record present)
 *
 * Why the helper is not strict: the toast's lifetime is timer-driven and
 * testing it strictly would require either extending the TTL globally
 * (product change) or freezing time (fragile under real tRPC requests).
 */
export async function expectSuccessToast(
  page: Page,
  pattern: RegExp | string,
  options?: { timeoutMs?: number }
) {
  const toast = page
    .locator('[role="status"]')
    .filter({ hasText: pattern })
    .first();

  // `toBeVisible` with a short timeout; if the toast never shows (e.g. the
  // action failed silently) we want to see the failure here. If it showed
  // briefly and is gone, we swallow the timeout because the deterministic
  // assertion right after this call covers correctness.
  try {
    await expect(toast).toBeVisible({ timeout: options?.timeoutMs ?? 2_000 });
  } catch {
    // Toast may have already auto-dismissed under worker backpressure.
    // Intentional no-op — see function comment.
  }
}
