import { test, expect } from '@playwright/test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { attachClientIssueTracker, expectNoClientIssues } from './support/app.js';

for (const language of ['en', 'es'] as const) {
  test(`creates the real first owner from an empty installation and preserves ownership after reload (${language})`, async ({
    page,
  }, testInfo) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'puntovivo-ui-installation-'));
    const databasePath = path.join(directory, 'local.db');
    const child = fork(path.resolve('e2e/shared/installation-server.mjs'), [databasePath], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PUNTOVIVO_E2E: '1',
        PUNTOVIVO_LOG_LEVEL: 'warn',
        PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const failures: string[] = [];
    child.stderr?.on('data', chunk => failures.push(String(chunk)));
    const exited = once(child, 'exit');
    try {
      const ready = await new Promise<{ url: string; token: string }>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Empty installation did not start: ${failures.join('')}`)),
          30_000
        );
        child.once('error', error => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', code => {
          clearTimeout(timeout);
          reject(new Error(`Empty installation exited: ${code}`));
        });
        child.once('message', message => {
          clearTimeout(timeout);
          resolve(message as { url: string; token: string });
        });
      });
      // Forward the browser's actual API traffic to this isolated Fastify process.
      // No response is fabricated and no business identity is seeded.
      await page.route('**/api/**', async route => {
        const original = new URL(route.request().url());
        const response = await route.fetch({
          url: `${ready.url}${original.pathname}${original.search}`,
        });
        await route.fulfill({ response });
      });
      await page.addInitScript(
        locale => localStorage.setItem('puntovivo-language-preference', locale),
        language
      );
      const tracker = attachClientIssueTracker(page);
      if (language === 'es') await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/login');
      await expect(
        page.getByRole('heading', {
          name: language === 'es' ? 'Empieza con tu negocio.' : 'Start with your business.',
        })
      ).toBeVisible();
      await expect(page.locator('#setup-businessName')).toBeFocused();
      await page.locator('#setup-businessName').fill(`UI Retail ${language}`);
      await page.locator('#setup-siteName').fill('Main Store');
      await page.locator('#setup-countryCode').selectOption('CO');
      await page
        .getByRole('button', { name: language === 'es' ? 'Continuar' : 'Continue', exact: true })
        .click();
      await expect(page.locator('#setup-ownerName')).toBeFocused();
      await page
        .getByRole('button', { name: language === 'es' ? 'Volver' : 'Back', exact: true })
        .click();
      await expect(page.locator('#setup-businessName')).toHaveValue(`UI Retail ${language}`);
      await page
        .getByRole('button', { name: language === 'es' ? 'Continuar' : 'Continue', exact: true })
        .click();
      await page.locator('#setup-ownerName').fill('UI Owner');
      await page.locator('#setup-email').fill(`ui-owner-${language}@example.com`);
      await page.locator('#setup-password').fill('OwnerPassword42!');
      await page.locator('#setup-confirmPassword').fill('OwnerPassword42!');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      // Capture before entering the private code: evidence must not carry a credential.
      await page.screenshot({
        path: testInfo.outputPath(`installation-owner-${language}.png`),
        fullPage: true,
      });
      await page.locator('#setup-token').fill(ready.token);
      await page
        .getByRole('button', {
          name: language === 'es' ? 'Crear mi espacio de trabajo' : 'Create my workspace',
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/company|\/dashboard/, { timeout: 30_000 });
      await page.reload();
      await expect(page.locator('#setup-businessName')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /UI Owner/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('button', { name: 'Main Store', exact: true })).toBeVisible();
      const db = new Database(databasePath, { readonly: true });
      try {
        expect(db.prepare('SELECT name, email, role FROM users').all()).toEqual([
          { name: 'UI Owner', email: `ui-owner-${language}@example.com`, role: 'admin' },
        ]);
        expect(db.prepare('SELECT name FROM tenants').all()).toEqual([
          { name: `UI Retail ${language}` },
        ]);
        expect(db.prepare('SELECT completion_kind FROM installation_setup').get()).toEqual({
          completion_kind: 'owner_claim',
        });
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'installation.owner_created'"
            )
            .get()
        ).toEqual({ n: 1 });
      } finally {
        db.close();
      }
      await expectNoClientIssues(tracker);
      expect(failures).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: 'wait' });
      let forcedExit = false;
      const deadline = setTimeout(() => {
        forcedExit = true;
        child.kill('SIGKILL');
      }, 5_000);
      try {
        if (child.connected) child.send('close');
        else if (child.exitCode === null) child.kill('SIGTERM');
        await exited;
      } finally {
        clearTimeout(deadline);
        await rm(directory, { recursive: true, force: true });
      }
      expect(forcedExit, 'the owned fixture server must shut down gracefully').toBe(false);
    }
  });
}
