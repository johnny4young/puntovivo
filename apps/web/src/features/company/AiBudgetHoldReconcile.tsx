// Admin recovery for unknown-cost AI calls. A remote call whose provider
// cost could not be determined (lost response, deadline after dispatch,
// crash) keeps the tenant's monthly AI admission held, fail-closed. The
// admin books the amount the provider actually billed (from its invoice or
// console) with a note; the server records it in the audit chain and
// releases the hold. Rendered inside the card's unknown-cost disclosure.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

export function AiBudgetHoldReconcile() {
  const { t } = useTranslation(['aiSettings', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [costInput, setCostInput] = useState('');
  const [note, setNote] = useState('');
  const reconcileMutation = trpc.ai.reconcileBudgetHold.useMutation({
    onSuccess: result => {
      setCostInput('');
      setNote('');
      toast.success({
        title: t('aiSettings:card.reconcile.successTitle'),
        description: t('aiSettings:card.reconcile.successDescription', {
          count: result.reconciledCalls,
        }),
      });
      void utils.ai.settings.get.invalidate();
    },
    onError: onErrorToast(toast, t, { titleKey: 'aiSettings:card.reconcile.errorTitle' }),
  });

  const costUsd = Number(costInput);
  const costValid = costInput.trim() !== '' && Number.isFinite(costUsd) && costUsd >= 0;
  const noteValid = note.trim().length >= 3;
  const submitDisabled = !costValid || !noteValid || reconcileMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitDisabled) return;
    reconcileMutation.mutate({ costUsd, note: note.trim() });
  }

  return (
    <form className="mt-3 space-y-2" onSubmit={handleSubmit} data-testid="ai-budget-hold-reconcile">
      <p className="text-xs leading-relaxed">{t('aiSettings:card.reconcile.hint')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
          {t('aiSettings:card.reconcile.costLabel')}
          <input
            className="input w-32"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.0001"
            value={costInput}
            onChange={event => setCostInput(event.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium">
          {t('aiSettings:card.reconcile.noteLabel')}
          <input
            className="input w-full"
            type="text"
            maxLength={500}
            value={note}
            placeholder={t('aiSettings:card.reconcile.notePlaceholder')}
            onChange={event => setNote(event.target.value)}
          />
        </label>
        <Button type="submit" size="compact" variant="outline" disabled={submitDisabled}>
          {reconcileMutation.isPending
            ? t('aiSettings:card.reconcile.submitting')
            : t('aiSettings:card.reconcile.submit')}
        </Button>
      </div>
    </form>
  );
}
