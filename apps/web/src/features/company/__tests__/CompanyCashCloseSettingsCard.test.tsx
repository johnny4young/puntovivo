import { render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMutate } = vi.hoisted(() => ({ updateMutate: vi.fn() }));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      cashCloseSettings: {
        get: { cancel: vi.fn(), getData: vi.fn(), setData: vi.fn(), invalidate: vi.fn() },
      },
    }),
    cashCloseSettings: {
      get: {
        useQuery: () => ({
          data: { blindClose: true, differenceTolerance: 5000 },
          isLoading: false,
        }),
      },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false }) },
    },
  },
}));

import { CompanyCashCloseSettingsCard } from '../CompanyCashCloseSettingsCard';

beforeEach(() => updateMutate.mockReset());

describe('CompanyCashCloseSettingsCard', () => {
  it('saves the difference tolerance on Enter and skips an unchanged value', async () => {
    const user = userEvent.setup();
    render(<CompanyCashCloseSettingsCard />);
    const input = screen.getByTestId('cash-close-tolerance');
    expect(input).toHaveValue(5000);

    await user.click(input);
    await user.tab();
    expect(updateMutate).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '2000{Enter}');
    expect(updateMutate).toHaveBeenCalledWith({ differenceTolerance: 2000 });
  });
});
