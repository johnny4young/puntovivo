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
    const { search, suspend, resume, charge, fastCash } = catalogue.checkout.shortcut;
    return [language, [search, suspend, resume, charge, fastCash]];
  })
) as Record<'en' | 'es', string[]>;

// Runs in the page. A nowrap label never reports scroll overflow (its flex
// item cannot shrink below its text), so geometry is what proves it stays
// inside its chip; `clipped` still guards against a reintroduced truncate.
function measureChips(keys: Element[]) {
  return keys.map(key => {
    const chip = key.parentElement;
    const label = chip?.querySelector('span');
    const card = chip?.parentElement?.parentElement;
    if (!chip || !label || !card) throw new Error('Missing checkout shortcut chip');
    const chipBox = chip.getBoundingClientRect();
    return {
      text: label.textContent?.trim(),
      left: chipBox.left,
      clipped: label.scrollWidth > label.clientWidth + 1,
      escapedChip: label.getBoundingClientRect().right > chipBox.right + 1,
      escapedCard: chipBox.right > card.getBoundingClientRect().right + 1,
    };
  });
}

for (const language of ['en', 'es'] as const) {
  test(`sales checkout keeps every ${language} shortcut label readable without moving mobile fast cash`, async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'cashier');
    await ensureLanguage(page, language);

    // Editing hints are a separate set; these assertions own the five action chips.
    const chips = page.getByTestId('checkout-shortcut-chips').locator('kbd');
    await expect(chips).toHaveCount(5);

    // 1024px is the narrowest side-column dock (lg: 18-20rem); 1280/1440 are xl.
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const labels = await chips.evaluateAll(measureChips);
      expect(
        labels.map(({ text, clipped, escapedChip, escapedCard }) => ({
          text,
          clipped,
          escapedChip,
          escapedCard,
        })),
        `${language} shortcut labels at ${width}px`
      ).toEqual(
        shortcutLabels[language].map(text => ({
          text,
          clipped: false,
          escapedChip: false,
          escapedCard: false,
        }))
      );
    }

    // The mobile checkout uses a separate action bar. Preserve the dock's
    // two-column order without asserting the broader Sales panel's viewport fit.
    await page.setViewportSize({ width: 375, height: 812 });
    const mobileChips = await chips.evaluateAll(measureChips);
    expect(mobileChips).toHaveLength(5);
    expect(mobileChips.every(chip => !chip.clipped && !chip.escapedChip && !chip.escapedCard)).toBe(
      true
    );
    expect(mobileChips[4]?.left).toBeCloseTo(mobileChips[0]!.left, 0);

    await expectNoClientIssues(tracker);
  });
}
