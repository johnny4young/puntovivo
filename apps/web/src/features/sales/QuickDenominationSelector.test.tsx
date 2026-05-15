import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuickDenominationSelector } from './QuickDenominationSelector';

describe('QuickDenominationSelector', () => {
  it('renders the Exact button plus smart suggestions above the total', () => {
    const { container } = render(
      <QuickDenominationSelector total={32_500} currentValue={0} onSelect={vi.fn()} />
    );
    expect(screen.getByText(/^Exact$/)).toBeInTheDocument();
    // 32_500 → next bill ≥ total is 50_000; bigger is 100_000; doubled is 65_000.
    // Currency formatting is locale-dependent so match on the digits only.
    const buttons = Array.from(container.querySelectorAll('button')).map(b => b.textContent ?? '');
    expect(buttons.some(text => /50[,.\s]?000/.test(text))).toBe(true);
    expect(buttons.some(text => /100[,.\s]?000/.test(text))).toBe(true);
    expect(buttons.some(text => /65[,.\s]?000/.test(text))).toBe(true);
  });

  it('calls onSelect with the chosen denomination', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <QuickDenominationSelector total={12_000} currentValue={0} onSelect={onSelect} />
    );
    const exact = screen.getByText(/^Exact$/).closest('button');
    expect(exact).not.toBeNull();
    await user.click(exact!);
    expect(onSelect).toHaveBeenCalledWith(12_000);
  });

  it('marks the active denomination with the primary border + tint', () => {
    render(
      <QuickDenominationSelector total={20_000} currentValue={20_000} onSelect={vi.fn()} />
    );
    const exact = screen.getByText(/^Exact$/).closest('button');
    expect(exact?.className).toContain('border-primary-400');
    expect(exact?.className).toContain('bg-primary-50');
  });

  it('renders an empty grid when the total is zero (no suggestions to make)', () => {
    const { container } = render(
      <QuickDenominationSelector total={0} currentValue={0} onSelect={vi.fn()} />
    );
    const selector = container.querySelector('[data-testid="quick-denomination-selector"]');
    expect(selector).not.toBeNull();
    // Only the Exact button remains (suggestions filter on >= total which
    // is vacuously empty here).
    expect(selector?.querySelectorAll('button').length).toBe(1);
  });
});
