import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login, loginAs } from './support/app';
import { seedWeighedProductScenario } from './support/db';

test.describe('POS Touch layout', () => {
  test('keeps the cart as a right rail with the charge action in view', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin');
    await page.goto('/touch');

    const cart = page.getByTestId('pos-touch-cart');
    const charge = page.getByTestId('pos-touch-cart-charge');
    // A site with quick keys opens on them; the catalog tiles sit under "All".
    await page.getByTestId('pos-touch-category-all').click();
    const tiles = page.locator('[data-testid^="pos-touch-tile-"]');
    await expect(tiles.first()).toBeVisible({ timeout: 15_000 });

    const tile = await tiles.first().boundingBox();
    const rail = await cart.boundingBox();
    expect(tile).not.toBeNull();
    expect(rail).not.toBeNull();
    expect(rail!.x).toBeGreaterThanOrEqual(tile!.x + tile!.width);
    expect(rail!.y).toBeLessThan(900);

    await expect(cart).toBeInViewport();
    await expect(charge).toBeInViewport();
    const pageScrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight
    );
    expect(pageScrolls).toBe(false);

    const tileCount = Math.min(await tiles.count(), 14);
    for (let index = 0; index < tileCount; index += 1) {
      await tiles.nth(index).click();
    }
    await expect(charge).toBeInViewport();

    // Keyboard focus must not land underneath the sticky charge footer.
    const removeButtons = cart.locator(
      '[data-testid^="pos-touch-cart-line-"][data-testid$="-remove"]'
    );
    await expect(removeButtons.first()).toBeVisible();
    // The seeded catalog is small, so a short viewport is what makes the rail overflow.
    await page.setViewportSize({ width: 1440, height: 560 });
    await expect(charge).toBeInViewport();
    await cart.evaluate(element => element.scrollTo(0, 0));
    const footer = cart.locator('footer');
    const footerTop = (await footer.boundingBox())!.y;
    const boxes = await removeButtons.evaluateAll(buttons =>
      buttons.map(button => button.getBoundingClientRect().bottom)
    );
    const hiddenIndex = boxes.findIndex(bottom => bottom > footerTop);
    expect(hiddenIndex).toBeGreaterThanOrEqual(0);

    await removeButtons.nth(hiddenIndex).focus();
    const focused = await removeButtons.nth(hiddenIndex).boundingBox();
    expect(focused!.y + focused!.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);

    await expectNoClientIssues(tracker);
  });
});

test.describe('POS Touch weighing', () => {
  test('asks the weight of a by-kilogram product and corrects the same line', async ({
    page,
  }, info) => {
    const scenario = seedWeighedProductScenario(`weigh-${info.parallelIndex}-${Date.now()}`);
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
    await page.goto('/touch');

    await page.getByTestId('pos-touch-category-all').click();
    await page.getByTestId(`pos-touch-tile-${scenario.product.id}`).click();

    const panel = page.getByTestId('weighed-item-panel');
    await expect(panel).toBeVisible();
    const lines = page
      .getByTestId('pos-touch-cart')
      .locator('li[data-testid^="pos-touch-cart-line-"]');
    await expect(lines).toHaveCount(0);

    await page.getByTestId('weighed-item-preset-0.25').click();
    await expect(page.getByTestId('weighed-item-readout')).toContainText(/0[.,]250 kg/);
    await page.getByTestId('weighed-item-preset-0.5').click();
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText(/0[.,]5 Kilogram/);

    await page.getByTestId('weighed-item-weight').click();
    await page.getByTestId('weighed-item-weight-input').fill('0.75');
    await page.getByTestId('weighed-item-submit').click();
    await expect(lines.first()).toContainText(/0[.,]75 Kilogram/);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(lines).toHaveCount(1);
    await expectNoClientIssues(tracker);
  });
});
