/**
 * First-use journey for the packaged desktop smoke.
 *
 * A packaged install no longer seeds an administrator whose password is
 * printed to stdout: the first operator claims the installation through the
 * renderer, and main injects the one-use setup capability itself (the renderer
 * never sees it). The smoke therefore chooses its own owner credentials,
 * completes that claim through the real setup form, signs out, and signs back
 * in with the same credentials. Nothing is read from process output, so a
 * regression that prints a credential again cannot make this journey pass.
 *
 * Selectors mirror `e2e/electron/installation-setup.spec.ts` and the proven
 * user-menu helper in `e2e/web/support/app.ts`.
 *
 * @module scripts/lib/packaged-first-use-journey
 */
import { randomBytes } from 'node:crypto';

const CONTINUE = /^(Continue|Continuar)$/;
const CREATE_WORKSPACE = /^(Create my workspace|Crear mi espacio de trabajo)$/;
const OPEN_USER_MENU = /^(?:Open user menu for|Abre el menú de usuario de) /i;
const SIGN_OUT = /^(Sign out|Cerrar sesión)$/;
const ENTER_WORKSPACE = /enter workspace|entrar al espacio de trabajo/i;

/**
 * Credentials a packaged desktop must never print: the password banner of the
 * old seeded administrator, and the one-use installation code that only a
 * headless standalone server hands to its operator (desktop main injects it).
 */
export const CREDENTIAL_BANNER = /\[Database\] Password:|Installation code:/;

/** Owner credentials the harness chooses; nothing is derived from app output. */
export function createSmokeOwnerCredentials(random = randomBytes) {
  return {
    email: `smoke-owner-${random(6).toString('hex')}@example.com`,
    // Hex keeps the random part free of characters a form could trim, and the
    // fixed affixes cover every class the password policy requires.
    password: `Smoke-${random(12).toString('hex')}-Aa1`,
  };
}

async function waitForWorkspace(page, timeoutMs) {
  await page
    .waitForFunction(
      () =>
        window.location.hash.includes('/dashboard') || window.location.hash.includes('/company'),
      undefined,
      { timeout: timeoutMs }
    )
    .catch(error => {
      throw new Error(`workspace route not reached from ${page.url()}: ${error.message}`);
    });
}

/** Claim the installation through both steps of the packaged setup form. */
export async function claimInstallation(page, credentials, { timeoutMs }) {
  const businessName = page.locator('#setup-businessName');
  await businessName.waitFor({ state: 'visible', timeout: timeoutMs });
  await businessName.fill('Smoke Retail');
  await page.locator('#setup-siteName').fill('Smoke Store');
  await page.locator('#setup-countryCode').selectOption('CO');
  await page.getByRole('button', { name: CONTINUE }).click();

  const ownerName = page.locator('#setup-ownerName');
  await ownerName.waitFor({ state: 'visible', timeout: timeoutMs });
  await ownerName.fill('Smoke Owner');
  await page.locator('#setup-email').fill(credentials.email);
  await page.locator('#setup-password').fill(credentials.password);
  await page.locator('#setup-confirmPassword').fill(credentials.password);
  // The packaged preload provides the native claim, so main supplies the setup
  // capability and the manual token field must not render.
  if ((await page.locator('#setup-token').count()) !== 0) {
    throw new Error('packaged renderer asked for a setup token instead of using the native claim');
  }
  await page.getByRole('button', { name: CREATE_WORKSPACE }).click();
  await waitForWorkspace(page, timeoutMs);
}

/**
 * Wait until the landing stops animating and loading before the smoke shuts
 * the app down. The journey reaches its landing within about 100 ms of signing
 * back in, while loading skeletons still animate; on X11, destroying the
 * window with a frame still in flight makes Chromium log SharedImageManager and
 * PutImage DrawableError errors. Polling uses timers, not animation frames, so
 * waiting never schedules a frame of its own.
 */
export async function settleRenderer(page, { quietMs = 750, timeoutMs = 15_000 } = {}) {
  const settled = await page.evaluate(
    ({ quietMs: quiet, timeoutMs: limit }) =>
      new Promise(resolve => {
        const started = performance.now();
        let lastActivity = started;
        const network = new PerformanceObserver(() => {
          lastActivity = performance.now();
        });
        network.observe({ type: 'resource' });
        const poll = () => {
          const now = performance.now();
          if (document.getAnimations().some(animation => animation.playState === 'running')) {
            lastActivity = now;
          }
          if (now - lastActivity >= quiet) {
            network.disconnect();
            resolve(true);
          } else if (now - started >= limit) {
            network.disconnect();
            resolve(false);
          } else {
            setTimeout(poll, 50);
          }
        };
        setTimeout(poll, 50);
      }),
    { quietMs, timeoutMs }
  );
  if (!settled) {
    throw new Error(`renderer was still animating or loading ${timeoutMs} ms after its landing`);
  }
}

/** Sign out, then prove the claimed credentials open the workspace again. */
export async function signBackIn(page, credentials, { timeoutMs }) {
  await page.locator('header').getByRole('button', { name: OPEN_USER_MENU }).click();
  await page.getByRole('button', { name: SIGN_OUT }).click();

  const email = page.locator('#email');
  await email.waitFor({ state: 'visible', timeout: timeoutMs });
  await email.fill(credentials.email);
  await page.locator('#password').fill(credentials.password);
  await page.getByRole('button', { name: ENTER_WORKSPACE }).click();
  await waitForWorkspace(page, timeoutMs);
}
