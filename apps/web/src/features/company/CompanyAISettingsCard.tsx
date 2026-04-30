/**
 * ENG-030 — Admin-only card for AI settings.
 *
 * Sits inside `CompanyPage`'s admin grid. Reads `ai.settings.get`,
 * writes via `ai.settings.update`, and exposes a "Test connection"
 * button that runs `ai.completeTest` end-to-end so the operator can
 * validate the env-var + provider round-trip without waiting for
 * ENG-031 (co-pilot) or ENG-033 (semantic search) to land.
 *
 * Provider selector renders all three providers; only Anthropic is
 * enabled in ENG-030. OpenAI and Ollama appear disabled with a
 * `(disponible con ENG-NNN)` hint so the admin sees the roadmap.
 */
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

export function CompanyAISettingsCard() {
  const { t } = useTranslation(['aiSettings', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.ai.settings.get.useQuery();

  // Controlled local-edit overlay. `null` means "fall back to the
  // server value"; user interaction sets the local override. We avoid
  // a useEffect-on-data-arrival hydration pattern (the lint rule
  // `react-hooks/no-cascading-renders` flags it) — instead the render
  // path reads `localValue ?? serverValue` everywhere.
  const [enabledLocal, setEnabledLocal] = useState<boolean | null>(null);
  const [providerLocal, setProviderLocal] = useState<
    'anthropic' | 'openai' | 'ollama' | null
  >(null);
  const [modelLocal, setModelLocal] = useState<string | null>(null);
  const [budgetLocal, setBudgetLocal] = useState<string | null>(null);

  const enabled = enabledLocal ?? settingsQuery.data?.enabled ?? false;
  const providerId = providerLocal ?? settingsQuery.data?.providerId ?? 'anthropic';
  const modelOverride = modelLocal ?? settingsQuery.data?.modelId ?? '';
  const budgetInput =
    budgetLocal ?? String(settingsQuery.data?.monthlyBudgetUsd ?? 0);

  const updateMutation = trpc.ai.settings.update.useMutation({
    onSuccess: async () => {
      await utils.ai.settings.get.invalidate();
      toast.success({ title: t('aiSettings:toast.saveSuccessTitle') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'aiSettings:toast.saveErrorTitle',
    }),
  });

  const testMutation = trpc.ai.completeTest.useMutation({
    onSuccess: result => {
      toast.success({
        title: t('aiSettings:toast.testSuccessTitle'),
        description: t('aiSettings:toast.testSuccessDescription', {
          model: result.model,
          durationMs: result.durationMs,
          cost: formatCurrency(result.costUsd, 'USD'),
        }),
      });
      void utils.ai.settings.get.invalidate();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'aiSettings:toast.testErrorTitle',
    }),
  });

  const data = settingsQuery.data;
  const availableProviders = useMemo(
    () => data?.availableProviders ?? [],
    [data?.availableProviders]
  );
  const selectedProviderEntry = useMemo(
    () => availableProviders.find(p => p.id === providerId),
    [availableProviders, providerId]
  );
  const defaultModelId =
    selectedProviderEntry?.defaultModelId ?? data?.defaultModelId ?? data?.effectiveModelId ?? '';

  const budgetNumber = (() => {
    const parsed = Number(budgetInput);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  })();
  const spentUsd = data?.currentMonthSpendUsd ?? 0;
  const overBudget = budgetNumber > 0 && spentUsd >= budgetNumber;

  const saveDisabled =
    updateMutation.isPending ||
    settingsQuery.isLoading ||
    selectedProviderEntry?.isImplemented === false;
  const testDisabled =
    testMutation.isPending ||
    !data?.providerConfigured ||
    !enabled;

  function handleSave(): void {
    if (saveDisabled) return;
    const trimmedModel = modelOverride.trim();
    updateMutation.mutate({
      enabled,
      monthlyBudgetUsd: budgetNumber,
      providerId,
      modelId: trimmedModel.length > 0 ? trimmedModel : null,
    });
  }

  return (
    <section className="card p-6 space-y-5" data-testid="company-ai-card">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Sparkles className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">
            {t('aiSettings:card.kicker')}
          </p>
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('aiSettings:card.title')}
          </h2>
          <p className="text-sm text-secondary-500">
            {t('aiSettings:card.description')}
          </p>
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={enabled}
          onChange={event => setEnabledLocal(event.target.checked)}
          data-testid="ai-enabled-toggle"
        />
        <span>
          <span className="font-medium text-secondary-800">
            {t('aiSettings:card.enableLabel')}
          </span>
          <span className="block text-xs text-secondary-500">
            {t('aiSettings:card.enableHint')}
          </span>
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-secondary-800">
          {t('aiSettings:card.providerLabel')}
        </span>
        <select
          className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
          value={providerId}
          onChange={event =>
            setProviderLocal(event.target.value as 'anthropic' | 'openai' | 'ollama')
          }
          data-testid="ai-provider-select"
        >
          {availableProviders.map(provider => (
            <option
              key={provider.id}
              value={provider.id}
              disabled={!provider.isImplemented}
            >
              {provider.id}
              {!provider.isImplemented
                ? ` (${t('aiSettings:card.providerComingIn')} ${provider.availableInTicket})`
                : ''}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-secondary-500">
          {t('aiSettings:card.providerHint')}
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-secondary-800">
          {t('aiSettings:card.modelLabel')}
        </span>
        <input
          type="text"
          className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
          value={modelOverride}
          onChange={event => setModelLocal(event.target.value)}
          placeholder={t('aiSettings:card.modelPlaceholder', {
            defaultModelId,
          })}
          data-testid="ai-model-input"
        />
        <span className="mt-1 block text-xs text-secondary-500">
          {t('aiSettings:card.modelHint')}
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-secondary-800">
          {t('aiSettings:card.budgetLabel')}
        </span>
        <input
          type="number"
          min="0"
          step="1"
          className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
          value={budgetInput ?? ''}
          onChange={event => setBudgetLocal(event.target.value)}
          data-testid="ai-budget-input"
        />
        <span className="mt-1 block text-xs text-secondary-500">
          {t('aiSettings:card.budgetHint')}
        </span>
      </label>

      <div
        className={
          overBudget
            ? 'surface-panel-muted text-sm text-danger-700'
            : 'surface-panel-muted text-sm text-secondary-600'
        }
        data-testid="ai-spend-display"
      >
        <span className="font-medium">
          {t('aiSettings:card.spentLabel')}:
        </span>{' '}
        {formatCurrency(spentUsd, 'USD')}{' '}
        {t('aiSettings:card.spentSuffix', {
          budget: formatCurrency(budgetNumber, 'USD'),
        })}
      </div>

      <p className="text-xs">
        <span
          className={
            data?.providerConfigured
              ? 'text-success-700'
              : 'text-secondary-500'
          }
          data-testid="ai-provider-badge"
        >
          {data?.providerConfigured
            ? t('aiSettings:card.providerOk')
            : t('aiSettings:card.providerMissing')}
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={saveDisabled}
          data-testid="ai-save-button"
        >
          {updateMutation.isPending
            ? t('aiSettings:card.savingAction')
            : t('aiSettings:card.saveAction')}
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={() => testMutation.mutate()}
          disabled={testDisabled}
          data-testid="ai-test-button"
        >
          {testMutation.isPending
            ? t('aiSettings:card.testingAction')
            : t('aiSettings:card.testAction')}
        </button>
      </div>
    </section>
  );
}
