import { expect, test } from '@playwright/test';
import { runAxeOnPage } from './support/a11y';

test('single-frame axe transport retains serious WCAG failures', async ({ page }) => {
  await page.setContent('<main><button></button></main>');
  await expect(runAxeOnPage(page, { singleFrame: true })).rejects.toThrow('button-name');
});

test('single-frame axe transport refuses to omit child frames', async ({ page }) => {
  await page.setContent(
    '<main><iframe title="Child content" srcdoc="<button></button>"></iframe></main>'
  );
  await expect.poll(() => page.frames().length).toBe(2);
  await expect(runAxeOnPage(page, { singleFrame: true })).rejects.toThrow(
    'requires no child frames'
  );
});
