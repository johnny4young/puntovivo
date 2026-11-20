import { expect, test } from '@playwright/test';
import en from '../../apps/web/src/i18n/locales/en/sales.json';
import es from '../../apps/web/src/i18n/locales/es/sales.json';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
} from './support/app';

const shortcutLabels = Object.fromEntries(
  (
    [
      ['en', en],
      ['es', es],
    ] as const
  ).map(([language, catalogue]) => {
    const { exactCash, charge, removeLine, parked, newSale, more } = catalogue.sell.keys;
    return [language, [exactCash, charge, removeLine, parked, newSale, more]];
  })
) as Record<'en' | 'es', string[]>;

// Runs in the page. A nowrap label never reports scroll overflow, so geometry
// is what proves each key and its label stay inside the strip.
function measureShortcuts(keys: Element[]) {
  return keys.map(key => {
    const shortcut = key.parentElement;
    const label = shortcut?.querySelector('span');
    const strip = shortcut?.closest('[data-testid="checkout-shortcut-chips"]');
    if (!shortcut || !label || !strip) throw new Error('Missing sales shortcut');
    const stripBox = strip.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    return {
      text: label.textContent?.trim(),
      clipped: label.scrollWidth > label.clientWidth + 1,
      escapedStrip:
        labelBox.right > stripBox.right + 1 || key.getBoundingClientRect().left < stripBox.left - 1,
    };
  });
}

for (const language of ['en', 'es'] as const) {
  test(`the sales shortcut strip keeps every ${language} key readable at each width`, async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'cashier');
    await ensureLanguage(page, language);

    const keys = page.getByTestId('checkout-shortcut-chips').locator('kbd');
    await expect(keys).toHaveCount(6);
    // The header preference settles before the lazy sales namespace renders.
    await expect
      .poll(async () => (await keys.evaluateAll(measureShortcuts)).map(key => key.text))
      .toEqual(shortcutLabels[language]);

    // One row from the two-column layout up; it wraps on a phone.
    for (const width of [1440, 1280, 1024, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(async () => keys.evaluateAll(measureShortcuts), {
          message: `${language} shortcut labels at ${width}px`,
        })
        .toEqual(
          shortcutLabels[language].map(text => ({ text, clipped: false, escapedStrip: false }))
        );
    }

    await expectNoClientIssues(tracker);
  });
}
