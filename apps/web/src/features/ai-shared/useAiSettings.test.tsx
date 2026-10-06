import { act, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

const settingsInvalidate = vi.fn(async () => undefined);
const getInvalidate = vi.fn(async () => undefined);
const toastSuccess = vi.fn();
let updateOptions: { onSuccess?: () => Promise<void> } = {};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      ai: { settings: { invalidate: settingsInvalidate, get: { invalidate: getInvalidate } } },
    }),
    ai: {
      settings: {
        get: { useQuery: () => ({ data: undefined }) },
        update: {
          useMutation: (options: typeof updateOptions) => {
            updateOptions = options;
            return { mutate: vi.fn(), isPending: false };
          },
        },
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn() }),
}));

import { useAiSettings } from './useAiSettings';

describe('useAiSettings', () => {
  it('refreshes every ai.settings read, including voice availability, after a save', async () => {
    const t = ((key: string) => key) as unknown as TFunction;
    renderHook(() => useAiSettings({ t, saveErrorTitleKey: 'common:status.error' }));

    await act(async () => {
      await updateOptions.onSuccess?.();
    });

    expect(settingsInvalidate).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith({ title: 'aiSettings:toast.saveSuccessTitle' });
  });
});
