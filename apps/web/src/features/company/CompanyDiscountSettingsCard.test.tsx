/**
 * discount-ladder editor contract: it hydrates from the server
 * value, keeps a local draft until Save, enforces the row bounds the server
 * mirrors, and never sends a partial edit the operator did not confirm.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { CompanyDiscountSettingsCard } from './CompanyDiscountSettingsCard';

const updateMutate = vi.fn(async () => undefined);
let mockTiers: Array<{ maxDays: number; pct: number }>;
let mockIsLoading = false;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      discountSettings: { get: { invalidate: vi.fn(async () => undefined) } },
    }),
    discountSettings: {
      get: {
        useQuery: () => ({
          data: mockIsLoading
            ? undefined
            : { expiryTiers: mockTiers, defaults: { expiryTiers: mockTiers } },
          isLoading: mockIsLoading,
          error: null,
        }),
      },
      update: {
        useMutation: () => ({ mutateAsync: updateMutate, isPending: false }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe('CompanyDiscountSettingsCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    mockIsLoading = false;
    mockTiers = [
      { maxDays: 7, pct: 30 },
      { maxDays: 15, pct: 20 },
      { maxDays: 30, pct: 10 },
    ];
  });

  it('hydrates one editable row per persisted tier', () => {
    render(<CompanyDiscountSettingsCard />);

    expect(screen.getByLabelText('Days left for tier 1')).toHaveValue(7);
    expect(screen.getByLabelText('Discount percent for tier 1')).toHaveValue(30);
    expect(screen.getByLabelText('Days left for tier 3')).toHaveValue(30);
    expect(screen.getByLabelText('Discount percent for tier 3')).toHaveValue(10);
  });

  it('keeps Save disabled until the draft actually differs', async () => {
    const user = userEvent.setup();
    render(<CompanyDiscountSettingsCard />);

    const save = screen.getByTestId('discount-save-tiers');
    expect(save).toBeDisabled();

    const pct = screen.getByLabelText('Discount percent for tier 1');
    await user.clear(pct);
    expect(pct).toHaveAttribute('aria-invalid', 'true');
    expect(save).toBeDisabled();
    await user.type(pct, '40');
    expect(pct).toHaveAttribute('aria-invalid', 'false');
    expect(save).toBeEnabled();
  });

  it('blocks duplicate thresholds instead of silently persisting a shorter ladder', async () => {
    const user = userEvent.setup();
    render(<CompanyDiscountSettingsCard />);

    const secondDays = screen.getByLabelText('Days left for tier 2');
    await user.clear(secondDays);
    await user.type(secondDays, '7');

    expect(screen.getByLabelText('Days left for tier 1')).toHaveAttribute('aria-invalid', 'true');
    expect(secondDays).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('discount-save-tiers')).toBeDisabled();
  });

  it('sends the full edited ladder on save', async () => {
    const user = userEvent.setup();
    render(<CompanyDiscountSettingsCard />);

    const days = screen.getByLabelText('Days left for tier 1');
    await user.clear(days);
    await user.type(days, '3');
    await user.click(screen.getByTestId('discount-save-tiers'));

    expect(updateMutate).toHaveBeenCalledWith({
      expiryTiers: [
        { maxDays: 3, pct: 30 },
        { maxDays: 15, pct: 20 },
        { maxDays: 30, pct: 10 },
      ],
    });
  });

  it('adds and removes rows within the server bounds', async () => {
    const user = userEvent.setup();
    render(<CompanyDiscountSettingsCard />);

    await user.click(screen.getByTestId('discount-add-tier'));
    expect(screen.getByLabelText('Days left for tier 4')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Remove tier 4'));
    expect(screen.queryByLabelText('Days left for tier 4')).not.toBeInTheDocument();

    // Cap at 5 rows (server MAX_TIERS).
    await user.click(screen.getByTestId('discount-add-tier'));
    await user.click(screen.getByTestId('discount-add-tier'));
    expect(screen.getByTestId('discount-add-tier')).toBeDisabled();
  });

  it('never lets the operator delete the last remaining tier', async () => {
    mockTiers = [{ maxDays: 7, pct: 30 }];
    render(<CompanyDiscountSettingsCard />);

    expect(screen.getByLabelText('Remove tier 1')).toBeDisabled();
  });

  it('adds an in-range threshold when the last tier already reaches 365 days', async () => {
    const user = userEvent.setup();
    mockTiers = [{ maxDays: 365, pct: 10 }];
    render(<CompanyDiscountSettingsCard />);

    await user.click(screen.getByTestId('discount-add-tier'));
    expect(screen.getByLabelText('Days left for tier 2')).toHaveValue(364);
    expect(screen.getByLabelText('Days left for tier 2')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByTestId('discount-save-tiers')).toBeEnabled();
  });
});
