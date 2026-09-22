import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen, within } from '@/test/utils';
import i18n from '@/i18n';
import { setActiveTenantLocale } from '@/lib/utils';
import { QuickDenominationSelector } from './QuickDenominationSelector';

afterEach(async () => {
  cleanup();
  setActiveTenantLocale(null);
  await i18n.changeLanguage('en');
});

describe('cash suggestion labels', () => {
  it.each([
    ['en', 'en-US', 'COP', 0, 'Amount', 'Exact'],
    ['es', 'es-CO', 'COP', 0, 'Monto', 'Exacto'],
    ['en', 'en-US', 'MXN', 2, 'Amount', 'Exact'],
    ['es', 'es-MX', 'MXN', 2, 'Monto', 'Exacto'],
    ['es', 'es-CL', 'CLP', 0, 'Monto', 'Exacto'],
    ['es', 'es-PE', 'PEN', 2, 'Monto', 'Exacto'],
  ] as const)(
    'labels calculated suggestions honestly in %s / %s / %s',
    async (language, locale, currency, displayDecimals, amountLabel, exactLabel) => {
      await i18n.changeLanguage(language);
      setActiveTenantLocale({
        locale,
        currency,
        displayDecimals,
        timezone: 'America/Bogota',
        dateFormatShort: 'yyyy-MM-dd',
      });
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(<QuickDenominationSelector total={3200} currentValue={0} onSelect={onSelect} />);
      const selector = within(screen.getByTestId('quick-denomination-selector'));
      const formatted = (value: number) =>
        new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          minimumFractionDigits: displayDecimals,
          maximumFractionDigits: displayDecimals,
        })
          .format(value)
          .replace(/\s+/g, ' ');
      // 7,000 is calculated from the total, not a claim about a physical banknote.
      const calculated = selector.getByRole('button', {
        name: name =>
          name.replace(/\s+/g, '') === `${amountLabel}${formatted(7000)}`.replace(/\s+/g, ''),
      });
      expect(selector.queryByText(/^(Bill|Billete)$/)).not.toBeInTheDocument();
      expect(selector.getAllByText(amountLabel)).toHaveLength(3);
      await user.click(calculated);
      expect(onSelect).toHaveBeenLastCalledWith(7000);
      await user.click(
        selector.getByRole('button', {
          name: name =>
            name.replace(/\s+/g, '') === `${exactLabel}${formatted(3200)}`.replace(/\s+/g, ''),
        })
      );
      expect(onSelect).toHaveBeenLastCalledWith(3200);
    }
  );
});
