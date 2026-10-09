import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
} from './support/app.js';

test('language selection does not scroll the page when opening the header dropdown', async ({
  page,
}, info) => {
  const tracker = attachClientIssueTracker(page);
  await loginAs(page, 'admin');
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const trigger = page.locator('header button[aria-haspopup="listbox"]').filter({
    hasText: /^(?:English|Español|System|Sistema)$/,
  });
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox).not.toBeNull();
  await page.mouse.click(
    triggerBox!.x + triggerBox!.width / 2,
    triggerBox!.y + triggerBox!.height / 2
  );
  await page.getByRole('listbox').evaluate(async list => {
    await Promise.all(list.parentElement!.getAnimations().map(animation => animation.finished));
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const optionBox = await page.getByRole('option', { name: 'Español', exact: true }).boundingBox();
  expect(optionBox).not.toBeNull();
  await page.mouse.click(optionBox!.x + optionBox!.width / 2, optionBox!.y + optionBox!.height / 2);
  await expect(trigger).toHaveText('Español');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await trigger.press('Enter');
  await trigger.press('ArrowDown');
  await trigger.press('ArrowDown');
  await trigger.press('Enter');
  await expect(trigger).toHaveText('English');
  await page.screenshot({
    path: info.outputPath('header-language-en.png'),
    animations: 'disabled',
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  // The helper must handle a control left open by a previous interaction.
  await trigger.press('Enter');
  await ensureLanguage(page, 'es');
  await expect(trigger).toHaveText('Español');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // No-op locale calls must also close a previously opened preference menu.
  await trigger.press('Enter');
  await ensureLanguage(page, 'es');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  // Mobile callers temporarily expose the real preference control and must
  // restore their viewport; visible page copy verifies the actual locale.
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 720 });
    await ensureLanguage(page, 'en');
    expect(page.viewportSize()).toEqual({ width, height: 720 });
    await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
    await ensureLanguage(page, 'es');
    expect(page.viewportSize()).toEqual({ width, height: 720 });
    await expect(page.getByRole('heading', { name: 'Inventario', exact: true })).toBeVisible();
    if (width === 375) {
      await page.screenshot({
        path: info.outputPath('header-language-es-375.png'),
        animations: 'disabled',
      });
    }
  }
  await expectNoClientIssues(tracker);
});
