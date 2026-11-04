import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, loginAs } from './support/app';

test.describe('POS Touch layout', () => {
  test('keeps the cart as a right rail with the charge action in view', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin');
    await page.goto('/touch');

    const cart = page.getByTestId('pos-touch-cart');
    const charge = page.getByTestId('pos-touch-cart-charge');
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
