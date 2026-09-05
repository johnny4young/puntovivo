import { render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessTypePicker } from './BusinessTypePicker';

const applyPresetMutate = vi.fn();
const invalidateEffective = vi.fn(async () => undefined);
const invalidateList = vi.fn(async () => undefined);
const invalidateReadiness = vi.fn(async () => undefined);
const toastError = vi.fn();
const updateTenantSettings = vi.fn();

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      modules: {
        getEffective: { invalidate: invalidateEffective },
        list: { invalidate: invalidateList },
      },
      setupReadiness: { get: { invalidate: invalidateReadiness } },
    }),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ updateTenantSettings }),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    path: string,
    options: { onSuccess?: (result: unknown, input: { presetId: string }) => Promise<void> | void }
  ) => ({
    mutate: (input: { presetId: string }) => {
      applyPresetMutate(path, input);
      void options.onSuccess?.({}, input);
    },
    isPending: false,
  }),
}));

describe('BusinessTypePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers every vertical and applies the picked preset', async () => {
    const user = userEvent.setup();
    render(<BusinessTypePicker current={null} />);

    for (const id of [
      'retail',
      'restaurant',
      'quickservice',
      'wholesale',
      'hardware',
      'butchery',
    ]) {
      expect(screen.getByTestId(`business-type-${id}`)).toBeInTheDocument();
    }

    await user.click(screen.getByTestId('business-type-restaurant'));

    // The preset id IS the business type: one call records both.
    expect(applyPresetMutate).toHaveBeenCalledWith('modules.applyPreset', {
      presetId: 'restaurant',
    });
  });

  it('refreshes the module and readiness reads so the guide advances', async () => {
    const user = userEvent.setup();
    render(<BusinessTypePicker current={null} />);

    await user.click(screen.getByTestId('business-type-retail'));

    expect(invalidateEffective).toHaveBeenCalled();
    expect(invalidateList).toHaveBeenCalled();
    expect(invalidateReadiness).toHaveBeenCalled();
    expect(updateTenantSettings).toHaveBeenCalledWith({ businessType: 'retail' });
  });

  it('marks the recorded vertical as the current choice', () => {
    render(<BusinessTypePicker current="wholesale" />);

    expect(screen.getByTestId('business-type-wholesale')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('business-type-retail')).toHaveAttribute('aria-pressed', 'false');
  });

  it('runs the onApplied callback after a successful pick', async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    render(<BusinessTypePicker current={null} onApplied={onApplied} />);

    await user.click(screen.getByTestId('business-type-quickservice'));

    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});
