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

/** The suggested amounts, in the order the cashier sees them. */
function suggestedAmounts() {
  return within(screen.getByTestId('quick-denomination-selector'))
    .getAllByRole('button')
    .slice(1)
    .map(button => normalize(button.textContent));
}

describe('QuickDenominationSelector', () => {
  it('offers the exact total and the next round amounts', () => {
    render(<QuickDenominationSelector total={87_420} currentValue={0} onSelect={vi.fn()} />);
    const exact = screen.getByTestId('quick-amount-exact');
    expect(exact).toHaveTextContent('Exact');
    expect(exact).toHaveTextContent('F2');
    expect(suggestedAmounts()).toEqual(
      [90_000, 100_000, 150_000].map(value => normalize(formatCurrency(value)))
    );
  });

  it('reports the chosen amount and leaves the form to own it', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<QuickDenominationSelector total={12_000} currentValue={0} onSelect={onSelect} />);

    await user.click(screen.getByText(/^Exact$/).closest('button')!);
    expect(onSelect).toHaveBeenLastCalledWith(12_000);
    await user.click(screen.getByTestId('quick-amount-20000'));
    expect(onSelect).toHaveBeenLastCalledWith(20_000);
  });

  it('marks the amount the cashier already entered', () => {
    render(<QuickDenominationSelector total={18_800} currentValue={20_000} onSelect={vi.fn()} />);
    expect(screen.getByTestId('quick-amount-20000')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('quick-amount-exact')).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not mark Exact when a 2-decimal tender is cents short', () => {
    const { rerender } = render(
      <QuickDenominationSelector
        total={32.5}
        currentValue={32.1}
        currencyCode="USD"
        onSelect={vi.fn()}
      />
    );
    const exact = () => screen.getByTestId('quick-amount-exact');
    expect(exact()).toHaveAttribute('aria-pressed', 'false');
    rerender(
      <QuickDenominationSelector
        total={32.5}
        currentValue={32.5}
        currencyCode="USD"
        onSelect={vi.fn()}
      />
    );
    expect(exact()).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the colours of the notes that make up an amount', () => {
    render(<QuickDenominationSelector total={87_420} currentValue={0} onSelect={vi.fn()} />);
    const swatch = within(screen.getByTestId('quick-amount-90000')).getByTestId(
      'quick-amount-swatch'
    );
    // 90.000 is a 50.000 and a 20.000 note.
    expect(swatch.children).toHaveLength(2);
    expect(
      within(screen.getByTestId('quick-amount-100000')).getByTestId('quick-amount-swatch').children
    ).toHaveLength(1);
  });

  it('leaves the swatch out when the currency has no catalogued notes', () => {
    render(
      <QuickDenominationSelector
        total={87.42}
        currentValue={0}
        currencyCode="XXX"
        onSelect={vi.fn()}
      />
    );
    expect(suggestedAmounts()).toHaveLength(3);
    expect(screen.queryByTestId('quick-amount-swatch')).not.toBeInTheDocument();
  });

  it('keeps only the Exact key when there is nothing to charge', () => {
    render(<QuickDenominationSelector total={0} currentValue={0} onSelect={vi.fn()} />);
    expect(suggestedAmounts()).toHaveLength(0);
  });

  it.each([
    ['en', 'en-US', 'COP', 0, 3_200, [4_000, 5_000, 10_000], 'Exact'],
    ['es', 'es-CO', 'COP', 0, 3_200, [4_000, 5_000, 10_000], 'Exacto'],
    ['es', 'es-MX', 'MXN', 2, 320, [350, 400, 500], 'Exacto'],
    ['es', 'es-CL', 'CLP', 0, 3_200, [4_000, 5_000, 10_000], 'Exacto'],
    ['es', 'es-PE', 'PEN', 2, 32, [40, 50, 100], 'Exacto'],
  ] as const)(
    'rounds to real notes in %s / %s / %s',
    async (language, locale, currency, displayDecimals, total, expected, exactLabel) => {
      await i18n.changeLanguage(language);
      setActiveTenantLocale({
        locale,
        currency,
        displayDecimals,
        timezone: 'America/Bogota',
        dateFormatShort: 'yyyy-MM-dd',
      });
      render(
        <QuickDenominationSelector
          total={total}
          currentValue={0}
          currencyCode={currency}
          onSelect={vi.fn()}
        />
      );
      expect(screen.getByTestId('quick-amount-exact')).toHaveTextContent(exactLabel);
      expect(suggestedAmounts()).toEqual(expected.map(value => normalize(formatCurrency(value))));
    }
  );
});
