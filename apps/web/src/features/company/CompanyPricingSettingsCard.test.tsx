/**
 * pricing-mode card contract (H2.1): it hydrates from the server flag,
 * keeps the choice as a local draft until Save, and only then sends the
 * mutation — flipping the tenant pricing mode must never happen from a
 * stray radio click.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { CompanyPricingSettingsCard } from './CompanyPricingSettingsCard';

const updateMutate = vi.fn(async () => undefined);
let mockPriceIncludesTax: boolean;
let mockIsLoading = false;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      companies: { getPricingSettings: { invalidate: vi.fn(async () => undefined) } },
    }),
    companies: {
      getPricingSettings: {
        useQuery: () => ({
          data: mockIsLoading ? undefined : { priceIncludesTax: mockPriceIncludesTax },
          isLoading: mockIsLoading,
          error: null,
        }),
      },
      updatePriceIncludesTax: {
        useMutation: () => ({ mutate: updateMutate, isPending: false }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe('CompanyPricingSettingsCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
    mockIsLoading = false;
    mockPriceIncludesTax = true;
  });

  it('hydrates the persisted mode and keeps Save disabled while unchanged', () => {
    render(<CompanyPricingSettingsCard />);

    expect(screen.getByRole('radio', { name: /Prices include tax/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Prices before tax/ })).not.toBeChecked();
    expect(screen.getByTestId('pricing-mode-save')).toBeDisabled();
  });

  it('sends the mutation only after an explicit Save of a changed draft', async () => {
    const user = userEvent.setup();
    render(<CompanyPricingSettingsCard />);

    await user.click(screen.getByRole('radio', { name: /Prices before tax/ }));
    expect(updateMutate).not.toHaveBeenCalled();

    const save = screen.getByTestId('pricing-mode-save');
    expect(save).toBeEnabled();
    await user.click(save);

    expect(updateMutate).toHaveBeenCalledWith({ priceIncludesTax: false });
  });

  it('hydrates an exclusive-mode tenant and lets it switch back', async () => {
    const user = userEvent.setup();
    mockPriceIncludesTax = false;
    render(<CompanyPricingSettingsCard />);

    expect(screen.getByRole('radio', { name: /Prices before tax/ })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: /Prices include tax/ }));
    await user.click(screen.getByTestId('pricing-mode-save'));
    expect(updateMutate).toHaveBeenCalledWith({ priceIncludesTax: true });
  });
});
