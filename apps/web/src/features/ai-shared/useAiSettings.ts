import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

/**
 * follow-up (dedup-ai) — core hook centralizing the AI settings
 * read + write seam shared by both AI surfaces:
 *
 * - `/ai-config` (`AiConfigPage`) — feature toggles + OCR provider + audit.
 * - `CompanyAISettingsCard` — admin card with budget meter + transcription.
 *
 * Both surfaces previously duplicated the exact same trio:
 * 1. `trpc.ai.settings.get.useQuery()` — the provider / feature-toggle read.
 * 2. `trpc.ai.settings.update.useMutation()` whose `onSuccess` invalidates
 * `ai.settings.get` and fires a success toast, and whose `onError` runs
 * `onErrorToast`.
 * 3. `trpc.useUtils()` purely to invalidate the read after a write.
 *
 * This hook owns all three so the two consumers stay byte-for-byte identical
 * in behavior. The only per-surface difference is the toast title keys, so
 * callers pass those in via {@link UseAiSettingsOptions}; the success body
 * (invalidate → `toast.success`) and the `onError` (`onErrorToast`) wiring are
 * shared. The success title key is uniform across both surfaces today
 * (`aiSettings:toast.saveSuccessTitle`) and defaults to it, but stays
 * overridable for symmetry with the error key.
 */
export interface UseAiSettingsOptions {
  /**
   * `t` from the consumer's `useTranslation`. Passed in (rather than created
   * inside the hook) so each surface keeps control of its own namespace list
   * the toast title keys resolve against the caller's loaded namespaces.
   */
  t: TFunction;
  /**
   * i18n key for the success toast title on `ai.settings.update`. Defaults to
   * `aiSettings:toast.saveSuccessTitle` (the value both surfaces use today).
   */
  saveSuccessTitleKey?: string;
  /**
   * i18n key forwarded to `onErrorToast` as the error toast title on
   * `ai.settings.update`. `/ai-config` uses `common:status.error`;
   * `CompanyAISettingsCard` uses `aiSettings:toast.saveErrorTitle`.
   */
  saveErrorTitleKey: string;
}

/** Resolved payload of `ai.settings.get` (provider + feature toggles). */
export type AiSettingsData = inferRouterOutputs<AppRouter>['ai']['settings']['get'];

export function useAiSettings(options: UseAiSettingsOptions) {
  const { t, saveErrorTitleKey } = options;
  const saveSuccessTitleKey = options.saveSuccessTitleKey ?? 'aiSettings:toast.saveSuccessTitle';

  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.ai.settings.get.useQuery();

  const updateMutation = trpc.ai.settings.update.useMutation({
    onSuccess: async () => {
      await utils.ai.settings.get.invalidate();
      toast.success({ title: t(saveSuccessTitleKey) });
    },
    onError: onErrorToast(toast, t, { titleKey: saveErrorTitleKey }),
  });

  return useMemo(
    () => ({
      /** The shared `ai.settings.get` query (data, isLoading, isPending, …). */
      settingsQuery,
      /** Resolved settings payload, or `undefined` until the first fetch. */
      data: settingsQuery.data,
      /**
       * The shared `ai.settings.update` mutation. `onSuccess` invalidates
       * `ai.settings.get` and emits the success toast; `onError` runs
       * `onErrorToast` with the caller's title key.
       */
      updateMutation,
    }),
    [settingsQuery, updateMutation]
  );
}

/** Return shape of {@link useAiSettings}. */
export type UseAiSettingsResult = ReturnType<typeof useAiSettings>;
