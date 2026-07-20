/**
 * the admin surface that makes  reachable.
 *
 * The load-bearing assertion here is the unit inversion: the operator types
 * "a point costs $1.000" and the server must receive `pointsPerUnit: 0.001`.
 * A silent slip in that conversion would mis-price every point the tenant
 * ever awards, so both directions (render and save) are pinned, along with
 * the preview line an admin actually reads before committing to a rate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { CompanyLoyaltySettingsCard } from './CompanyLoyaltySettingsCard';

const updateMock = vi.fn();
let mockSettings: { enabled: boolean; pointsPerUnit: number } | undefined;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ loyalty: { settings: { invalidate: vi.fn() } } }),
    loyalty: {
      settings: {
        useQuery: () => ({ data: mockSettings, isLoading: false, error: null }),
      },
      updateSettings: {
        useMutation: () => ({ mutateAsync: updateMock, isPending: false }),
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe('CompanyLoyaltySettingsCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
    vi.clearAllMocks();
    mockSettings = { enabled: false, pointsPerUnit: 0.001 };
  });

  it('renders the stored rate as currency per point, not as the raw multiplier', () => {
    render(<CompanyLoyaltySettingsCard />);
    // 0.001 points per unit === one point per $1.000. The admin never sees
    // 0.001, and the IEEE754 round-trip (1 / 0.001 = 999.999…) is snapped.
    expect(screen.getByTestId('loyalty-rate-input')).toHaveValue(1000);
  });

  it('converts the typed rate back to points per unit on save', async () => {
    const user = userEvent.setup();
    render(<CompanyLoyaltySettingsCard />);

    const input = screen.getByTestId('loyalty-rate-input');
    await user.clear(input);
    await user.type(input, '500');
    await user.click(screen.getByTestId('loyalty-save-rate'));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ pointsPerUnit: 1 / 500 }));
  });

  it('previews what a real sale would earn at the drafted rate', async () => {
    const user = userEvent.setup();
    render(<CompanyLoyaltySettingsCard />);

    // Default rate: a $50.000 sale earns 50 points.
    expect(screen.getByTestId('loyalty-rate-preview')).toHaveTextContent('50 puntos');

    const input = screen.getByTestId('loyalty-rate-input');
    await user.clear(input);
    await user.type(input, '5000');
    // Ten times stingier — the preview moves before anything is saved.
    expect(screen.getByTestId('loyalty-rate-preview')).toHaveTextContent('10 puntos');
  });

  it('refuses to save a rate below the floor and says why', async () => {
    const user = userEvent.setup();
    render(<CompanyLoyaltySettingsCard />);

    const input = screen.getByTestId('loyalty-rate-input');
    await user.clear(input);
    await user.type(input, '0');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('loyalty-save-rate')).toBeDisabled();
    expect(screen.getByTestId('loyalty-rate-preview')).toHaveTextContent('1 o más');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('toggles the program straight through without waiting for Save', async () => {
    const user = userEvent.setup();
    render(<CompanyLoyaltySettingsCard />);

    await user.click(screen.getByTestId('loyalty-enabled-toggle'));
    // The switch is its own decision; only the rate is a draft.
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ enabled: true }));
  });

  it('reflects an already-enabled program', () => {
    mockSettings = { enabled: true, pointsPerUnit: 0.002 };
    render(<CompanyLoyaltySettingsCard />);

    expect(screen.getByTestId('loyalty-enabled-toggle')).toBeChecked();
    expect(screen.getByTestId('loyalty-rate-input')).toHaveValue(500);
  });
});
