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

/** Kicker and amount as separate spans, so the accessible name keeps both words. */
function shortcuts() {
  return within(screen.getByTestId('quick-denomination-selector'))
    .getAllByRole('button')
    .map(button => ({
      button,
      kicker: normalize(button.children[0]?.textContent),
      amount: normalize(button.children[1]?.textContent),
    }));
}

describe('QuickDenominationSelector', () => {
  it('renders the Exact button plus smart suggestions above the total', () => {
    render(<QuickDenominationSelector total={32_500} currentValue={0} onSelect={vi.fn()} />);
    expect(screen.getByText(/^Exact$/)).toBeInTheDocument();
    // 32_500 → next bill ≥ total is 50_000; bigger is 100_000; doubled is 65_000.
    expect(shortcuts().map(s => s.amount)).toEqual(
      [32_500, 50_000, 65_000, 100_000].map(v => normalize(formatCurrency(v)))
    );
  });

  it('orders suggestions ascending even when the doubled total is smallest', () => {
    render(<QuickDenominationSelector total={3_200} currentValue={0} onSelect={vi.fn()} />);
    expect(shortcuts().map(s => s.amount)).toEqual(
      [3_200, 7_000, 10_000, 20_000].map(v => normalize(formatCurrency(v)))
    );
  });

  it('calls onSelect with the chosen denomination', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<QuickDenominationSelector total={12_000} currentValue={0} onSelect={onSelect} />);
    const exact = screen.getByText(/^Exact$/).closest('button');
    expect(exact).not.toBeNull();
    await user.click(exact!);
    expect(onSelect).toHaveBeenCalledWith(12_000);
  });

  it('marks the active denomination with the primary border + tint', () => {
    render(<QuickDenominationSelector total={20_000} currentValue={20_000} onSelect={vi.fn()} />);
    const exact = screen.getByText(/^Exact$/).closest('button');
    expect(exact?.className).toContain('border-primary-400');
    expect(exact?.className).toContain('bg-primary-50');
  });

  it('does not mark Exact active when a 2-decimal tender is cents short', () => {
    const { rerender } = render(
      <QuickDenominationSelector total={32.5} currentValue={32.1} onSelect={vi.fn()} />
    );
    const exact = () => screen.getByText(/^Exact$/).closest('button');
    expect(exact()?.className).not.toContain('border-primary-400');
    rerender(<QuickDenominationSelector total={32.5} currentValue={32.5} onSelect={vi.fn()} />);
    expect(exact()?.className).toContain('border-primary-400');
  });

  it('renders an empty grid when the total is zero (no suggestions to make)', () => {
    render(<QuickDenominationSelector total={0} currentValue={0} onSelect={vi.fn()} />);
    // Only the Exact button remains (suggestions filter on >= total which
    // is vacuously empty here).
    expect(shortcuts()).toHaveLength(1);
  });

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
      const buttons = shortcuts();
      const find = (kicker: string, value: number) =>
        buttons.find(s => s.kicker === kicker && s.amount === normalize(formatCurrency(value)));
      expect(buttons.map(s => s.kicker)).toEqual([
        exactLabel,
        amountLabel,
        amountLabel,
        amountLabel,
      ]);
      // 7,000 is calculated from the total, not a claim about a physical banknote.
      const calculated = find(amountLabel, 7000);
      expect(calculated).toBeDefined();
      await user.click(calculated!.button);
      expect(onSelect).toHaveBeenLastCalledWith(7000);
      await user.click(find(exactLabel, 3200)!.button);
      expect(onSelect).toHaveBeenLastCalledWith(3200);
    }
  );
});
