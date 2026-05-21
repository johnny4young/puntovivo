/**
 * ENG-135 — CompanyTelemetryCard tests.
 *
 * Pins:
 *   - The status panel reflects the current `telemetryOptIn` value.
 *   - Clicking the toggle calls `updateTelemetryOptIn` with the
 *     inverted boolean and invalidates the company cache.
 *   - A failed mutation surfaces the error via the toast hook.
 *
 * @module features/company/__tests__/CompanyTelemetryCard.test
 */
import { render, screen, fireEvent } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyTelemetryCard } from '../CompanyTelemetryCard';

interface CompanyData {
  telemetryOptIn: boolean;
}

const companyQueryRef: { current: { data?: CompanyData; isLoading: boolean } } = {
  current: { data: { telemetryOptIn: false }, isLoading: false },
};

const updateMutate = vi.fn();
const invalidateSpy = vi.fn();
let mutationCallbacks: {
  onSuccess?: (result: { telemetryOptIn: boolean }) => void | Promise<void>;
  onError?: (error: unknown) => void;
} = {};
let updateMutationState = { isPending: false };

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/translateServerError', () => ({
  translateServerError: (err: unknown) =>
    err instanceof Error ? err.message : 'unknown error',
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      companies: { getCurrent: { invalidate: invalidateSpy } },
    }),
    companies: {
      getCurrent: {
        useQuery: () => companyQueryRef.current,
      },
      updateTelemetryOptIn: {
        useMutation: (opts: {
          onSuccess?: (result: { telemetryOptIn: boolean }) => void | Promise<void>;
          onError?: (error: unknown) => void;
        }) => {
          mutationCallbacks = opts;
          return {
            mutate: (input: { optedIn: boolean }) => {
              updateMutate(input);
            },
            isPending: updateMutationState.isPending,
          };
        },
      },
    },
  },
}));

beforeEach(() => {
  companyQueryRef.current = {
    data: { telemetryOptIn: false },
    isLoading: false,
  };
  updateMutate.mockReset();
  invalidateSpy.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  updateMutationState = { isPending: false };
  mutationCallbacks = {};
});

describe('CompanyTelemetryCard (ENG-135)', () => {
  it('renders the disabled state when opt-in is false', () => {
    render(<CompanyTelemetryCard />);
    expect(screen.getByTestId('company-telemetry-status').textContent).toMatch(
      /off|desactivada/i
    );
    const button = screen.getByTestId('company-telemetry-toggle');
    expect(button.textContent).toMatch(/enable|activar/i);
  });

  it('renders the enabled state when opt-in is true', () => {
    companyQueryRef.current = { data: { telemetryOptIn: true }, isLoading: false };
    render(<CompanyTelemetryCard />);
    expect(screen.getByTestId('company-telemetry-status').textContent).toMatch(
      /on|activa/i
    );
    const button = screen.getByTestId('company-telemetry-toggle');
    expect(button.textContent).toMatch(/disable|desactivar/i);
  });

  it('mutates with the inverted boolean and invalidates getCurrent on success', async () => {
    render(<CompanyTelemetryCard />);
    fireEvent.click(screen.getByTestId('company-telemetry-toggle'));
    expect(updateMutate).toHaveBeenCalledWith({ optedIn: true });

    await mutationCallbacks.onSuccess?.({ telemetryOptIn: true });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it('surfaces a toast error when the mutation fails', async () => {
    render(<CompanyTelemetryCard />);
    fireEvent.click(screen.getByTestId('company-telemetry-toggle'));
    mutationCallbacks.onError?.(new Error('network down'));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]?.description).toContain('network down');
  });
});
