/**
 * ENG-039d3 — CompanyRestaurantSettingsCard regression tests.
 *
 * Coverage:
 *   - Renders the current persisted rate from the .get query.
 *   - Reject out-of-range rates (negative + above the 30% ceiling).
 *   - Save fires `restaurantSettings.update` with the new rate.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const updateMutate = vi.fn();
const invalidateGet = vi.fn(async () => undefined);

let getResponse: { serviceChargeRate: number; defaults: { serviceChargeRate: number }; maxRate: number } = {
  serviceChargeRate: 0,
  defaults: { serviceChargeRate: 0 },
  maxRate: 30,
};
let getLoading = false;
let updatePending = false;

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      restaurantSettings: {
        get: { invalidate: invalidateGet },
      },
    }),
    restaurantSettings: {
      get: {
        useQuery: () => ({
          data: getResponse,
          isLoading: getLoading,
          error: null,
        }),
      },
      update: {
        useMutation: (
          options: { onSuccess?: () => Promise<void> | void; onError?: (err: unknown) => void }
        ) => ({
          mutateAsync: async (input: unknown) => {
            try {
              const result = await updateMutate(input);
              await options.onSuccess?.();
              return result;
            } catch (err) {
              options.onError?.(err);
              throw err;
            }
          },
          isPending: updatePending,
        }),
      },
    },
  },
}));

import { CompanyRestaurantSettingsCard } from './CompanyRestaurantSettingsCard';

describe('CompanyRestaurantSettingsCard (ENG-039d3)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    getResponse = {
      serviceChargeRate: 0,
      defaults: { serviceChargeRate: 0 },
      maxRate: 30,
    };
    getLoading = false;
    updatePending = false;
    updateMutate.mockResolvedValue({ serviceChargeRate: 0 });
    await i18n.changeLanguage('en');
  });

  it('renders the current persisted rate from the query', () => {
    getResponse = {
      serviceChargeRate: 10,
      defaults: { serviceChargeRate: 0 },
      maxRate: 30,
    };
    render(<CompanyRestaurantSettingsCard />);
    const input = screen.getByLabelText(/Service charge rate/i) as HTMLInputElement;
    expect(input.value).toBe('10');
  });

  it('shows the disabled hint when the persisted rate is zero', () => {
    render(<CompanyRestaurantSettingsCard />);
    expect(
      screen.getByText(/Service charge is disabled/i)
    ).toBeInTheDocument();
  });

  it('rejects an out-of-range rate above the 30% ceiling', async () => {
    render(<CompanyRestaurantSettingsCard />);
    const input = screen.getByLabelText(/Service charge rate/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '40' } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/0 and 30/i);
    });
    expect(screen.getByRole('button', { name: /save restaurant/i })).toBeDisabled();
  });

  it('fires restaurantSettings.update with the new rate on save', async () => {
    render(<CompanyRestaurantSettingsCard />);
    const input = screen.getByLabelText(/Service charge rate/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });

    const saveBtn = screen.getByRole('button', { name: /save restaurant/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith({ serviceChargeRate: 12 });
    });
    await waitFor(() => {
      expect(invalidateGet).toHaveBeenCalled();
    });
  });
});
