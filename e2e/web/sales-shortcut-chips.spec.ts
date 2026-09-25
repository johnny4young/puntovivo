import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
} from './support/app';

const shortcutLabels = {
  en: ['Search', 'Suspend', 'Resume', 'Charge', 'Fast cash'],
  es: ['Buscar', 'Pausar', 'Retomar', 'Cobrar', 'Cobro rápido'],
} as const;

for (const language of ['en', 'es'] as const) {
  test(`sales checkout keeps every ${language} shortcut label readable without moving mobile fast cash`, async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'cashier');
    await ensureLanguage(page, language);

    const heading = page.getByText(language === 'es' ? 'Atajos' : 'Shortcuts', { exact: true });
    const card = heading.locator('..');
    await expect(card.locator('kbd')).toHaveCount(5);

    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const labels = await card.locator('kbd').evaluateAll(keys =>
        keys.map(key => {
          const chip = key.parentElement;
          const label = chip?.querySelector('span');
          const card = chip?.parentElement;
          if (!chip || !label || !card) throw new Error('Missing checkout shortcut chip');
          return {
            text: label.textContent?.trim(),
            clipped: label.scrollWidth > label.clientWidth + 1,
            escapedCard:
              chip.getBoundingClientRect().right > card.getBoundingClientRect().right + 1,
          };
        })
      );

      expect(labels.map(label => label.text)).toEqual(shortcutLabels[language]);
      expect(labels, `${language} shortcut labels at ${width}px`).toEqual(
        shortcutLabels[language].map(text => ({ text, clipped: false, escapedCard: false }))
      );
    }

    // The mobile checkout uses a separate action bar. Preserve the dock's
    // two-column order without asserting the broader Sales panel's viewport fit.
    await page.setViewportSize({ width: 375, height: 812 });
    const mobileChips = await card.locator('kbd').evaluateAll(keys =>
      keys.map(key => {
        const chip = key.parentElement;
        const label = chip?.querySelector('span');
        if (!chip || !label) throw new Error('Missing checkout shortcut chip');
        return {
          left: chip.getBoundingClientRect().left,
          clipped: label.scrollWidth > label.clientWidth + 1,
        };
      })
    );
    expect(mobileChips).toHaveLength(5);
    expect(mobileChips.every(chip => !chip.clipped)).toBe(true);
    expect(mobileChips[4]?.left).toBeCloseTo(mobileChips[0]!.left, 0);

    await expectNoClientIssues(tracker);
  });
}
