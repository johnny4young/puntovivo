import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const updateMutate = vi.fn();
const cancelGet = vi.fn(async () => undefined);
const invalidateGet = vi.fn(async () => undefined);

let currency = 'COP';
let getResponse: {
  blindClose: boolean;
  cashRoundingStep: number | null;
  defaults: { blindClose: boolean; cashRoundingStep: number | null };
} = {
  blindClose: true,
  cashRoundingStep: null,
  defaults: { blindClose: true, cashRoundingStep: null },
};

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/features/locale/LocaleProvider', () => ({
  useResolvedLocale: () => ({
    currency,
    country: currency === 'COP' ? 'CO' : 'US',
    locale: currency === 'COP' ? 'es-CO' : 'en-US',
    currencySymbol: '$',
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      cashCloseSettings: {
        get: {
          cancel: cancelGet,
          getData: () => getResponse,
          setData: vi.fn(),
          invalidate: invalidateGet,
        },
      },
    }),
    cashCloseSettings: {
      get: {
        useQuery: () => ({
          data: getResponse,
          isLoading: false,
          error: null,
        }),
      },
      update: {
        useMutation: (options: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            updateMutate(input);
            options.onSuccess?.();
          },
          isPending: false,
        }),
      },
    },
  },
}));

import { CompanyCashCloseSettingsCard } from './CompanyCashCloseSettingsCard';

describe('CompanyCashCloseSettingsCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    currency = 'COP';
    getResponse = {
      blindClose: true,
      cashRoundingStep: null,
      defaults: { blindClose: true, cashRoundingStep: null },
    };
    await i18n.changeLanguage('es');
  });

  it('shows the COP 50 cash rounding toggle and toggles between 50 and null', () => {
    render(<CompanyCashCloseSettingsCard />);
    const toggle = screen.getByTestId('cash-close-rounding-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(updateMutate).toHaveBeenCalledWith({ cashRoundingStep: 50 });

    getResponse = { ...getResponse, cashRoundingStep: 50 };
    render(<CompanyCashCloseSettingsCard />);
    const enabledToggle = screen.getAllByTestId(
      'cash-close-rounding-toggle'
    )[1] as HTMLInputElement;
    expect(enabledToggle.checked).toBe(true);
    fireEvent.click(enabledToggle);
    expect(updateMutate).toHaveBeenCalledWith({ cashRoundingStep: null });
  });

  it('hides the cash rounding toggle for two-decimal currencies like USD', () => {
    currency = 'USD';
    render(<CompanyCashCloseSettingsCard />);
    expect(screen.queryByTestId('cash-close-rounding-toggle')).not.toBeInTheDocument();
  });
});
