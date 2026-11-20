import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { cleanup, render, screen, within } from '@/test/utils';
import i18n from '@/i18n';
import { formatCurrency, setActiveTenantLocale } from '@/lib/utils';
import { QuickDenominationSelector } from './QuickDenominationSelector';

afterEach(async () => {
  cleanup();
  setActiveTenantLocale(null);
  await i18n.changeLanguage('en');
});

const normalize = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const keys = () => within(screen.getByTestId('quick-denomination-selector')).getAllByRole('button');

describe('QuickDenominationSelector', () => {
  it('offers Exact on F2 and the round amounts the cash keys already suggest', () => {
    render(<QuickDenominationSelector total={87_420} currentValue={0} onSelect={vi.fn()} />);
    const exact = screen.getByTestId('quick-denomination-exact');
    expect(exact).toHaveAccessibleName('Exact');
    expect(exact).toHaveAttribute('aria-keyshortcuts', 'F2');
    expect(
      keys()
        .slice(1)
        .map(button => normalize(button.textContent))
    ).toEqual([90_000, 100_000, 200_000].map(value => normalize(formatCurrency(value))));
  });

  it('reports the chosen amount to the form', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<QuickDenominationSelector total={12_000} currentValue={0} onSelect={onSelect} />);
    await user.click(screen.getByTestId('quick-denomination-exact'));
    expect(onSelect).toHaveBeenLastCalledWith(12_000);
    await user.click(screen.getByTestId('quick-denomination-20000'));
    expect(onSelect).toHaveBeenLastCalledWith(20_000);
  });

  it('presses the key that matches the received amount, never a few cents short', () => {
    const { rerender } = render(
      <QuickDenominationSelector total={32.5} currentValue={32.1} onSelect={vi.fn()} />
    );
    expect(screen.getByTestId('quick-denomination-exact')).toHaveAttribute('aria-pressed', 'false');
    rerender(<QuickDenominationSelector total={32.5} currentValue={32.5} onSelect={vi.fn()} />);
    expect(screen.getByTestId('quick-denomination-exact')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps only Exact when there is nothing to round up', () => {
    render(<QuickDenominationSelector total={0} currentValue={0} onSelect={vi.fn()} />);
    expect(keys()).toHaveLength(1);
  });

  it.each([
    ['en', 'en-US', 'COP', 0, 'How much do they pay with?', 'Exact'],
    ['es', 'es-CO', 'COP', 0, '¿Con cuánto paga?', 'Exacto'],
    ['es', 'es-PE', 'PEN', 2, '¿Con cuánto paga?', 'Exacto'],
  ] as const)(
    'names the group and Exact in %s / %s / %s',
    async (language, locale, currency, displayDecimals, title, exact) => {
      await i18n.changeLanguage(language);
      setActiveTenantLocale({
        locale,
        currency,
        displayDecimals,
        timezone: 'America/Bogota',
        dateFormatShort: 'yyyy-MM-dd',
      });
      render(<QuickDenominationSelector total={3200} currentValue={0} onSelect={vi.fn()} />);
      expect(screen.getByRole('group', { name: title })).toBeInTheDocument();
      expect(screen.getByTestId('quick-denomination-exact')).toHaveAccessibleName(exact);
      expect(screen.getByTestId('quick-denomination-4000')).toHaveTextContent(
        normalize(formatCurrency(4000))
      );
    }
  );
});
