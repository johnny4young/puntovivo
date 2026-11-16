import { useState } from 'react';
import { Plus, QrCode, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

type TransferHandles = inferRouterOutputs<AppRouter>['paymentSettings']['transferHandles'];
type Handle = TransferHandles['handles'][number];

const KINDS: readonly Handle['kind'][] = ['breb', 'nequi', 'daviplata', 'bank', 'other'];
const MAX_HANDLES = 4;

interface Draft {
  handles: Handle[];
  qrPayload: string;
}

/**
 * Where customers send a transfer: the keys and numbers the checkout shows
 * as a QR. Nothing here connects to a wallet; the cashier confirms receipt.
 */
export function CompanyTransferHandlesCard() {
  const { t } = useTranslation(['operations', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const query = trpc.paymentSettings.transferHandles.useQuery();
  // Null until the admin edits, so a refetch never overwrites typing in progress.
  const [draft, setDraft] = useState<Draft | null>(null);
  const saved: Draft = {
    handles: query.data?.handles ?? [],
    qrPayload: query.data?.qrPayload ?? '',
  };
  const current = draft ?? saved;
  const update = (next: Partial<Draft>) => setDraft({ ...current, ...next });

  const mutation = trpc.paymentSettings.updateTransferHandles.useMutation({
    onSuccess: async () => {
      await utils.paymentSettings.transferHandles.invalidate();
      setDraft(null);
      toast.success({ title: t('operations:payments.transferHandles.savedToast') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:payments.transferHandles.saveErrorToast',
    }),
  });

  if (query.isLoading) {
    return (
      <div className="card p-6" data-testid="transfer-handles-loading">
        <p className="text-sm text-secondary-500">{t('common:actions.loading')}</p>
      </div>
    );
  }

  const hasBlank = current.handles.some(handle => handle.value.trim().length === 0);

  return (
    <form
      className="card space-y-4 p-6"
      data-testid="transfer-handles-card"
      onSubmit={event => {
        event.preventDefault();
        if (hasBlank) return;
        mutation.mutate({
          handles: current.handles.map(handle => ({ ...handle, value: handle.value.trim() })),
          qrPayload: current.qrPayload.trim() || null,
        });
      }}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="pv-gt pv-gt-primary h-9 w-9">
            <QrCode className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="pv-title text-lg">{t('operations:payments.transferHandles.title')}</h2>
        </div>
        <p className="text-sm text-secondary-600">
          {t('operations:payments.transferHandles.description')}
        </p>
      </div>

      <ul className="space-y-2">
        {current.handles.map((handle, index) => (
          // Rows have no identity beyond their position in this short list.
          <li key={index} className="grid gap-2 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
            <select
              className="input"
              aria-label={t('operations:payments.transferHandles.kindLabel', { index: index + 1 })}
              value={handle.kind}
              onChange={event =>
                update({
                  handles: current.handles.map((row, rowIndex) =>
                    rowIndex === index
                      ? { ...row, kind: event.target.value as Handle['kind'] }
                      : row
                  ),
                })
              }
            >
              {KINDS.map(kind => (
                <option key={kind} value={kind}>
                  {t(`operations:payments.transferHandles.kinds.${kind}`)}
                </option>
              ))}
            </select>
            <input
              className="input"
              maxLength={80}
              autoComplete="off"
              aria-label={t('operations:payments.transferHandles.valueLabel', {
                index: index + 1,
              })}
              placeholder={t('operations:payments.transferHandles.valuePlaceholder')}
              value={handle.value}
              onChange={event =>
                update({
                  handles: current.handles.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, value: event.target.value } : row
                  ),
                })
              }
              data-testid={`transfer-handle-value-${index}`}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('operations:payments.transferHandles.remove', { index: index + 1 })}
              onClick={() =>
                update({ handles: current.handles.filter((_, rowIndex) => rowIndex !== index) })
              }
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      {current.handles.length < MAX_HANDLES && (
        <Button
          variant="outline"
          onClick={() => update({ handles: [...current.handles, { kind: 'breb', value: '' }] })}
          data-testid="transfer-handle-add"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('operations:payments.transferHandles.add')}
        </Button>
      )}

      <div>
        <label htmlFor="transfer-handles-qr-payload" className="label">
          {t('operations:payments.transferHandles.qrPayloadLabel')}
        </label>
        <textarea
          id="transfer-handles-qr-payload"
          className="input mt-1 min-h-[72px] font-mono text-sm"
          maxLength={512}
          value={current.qrPayload}
          onChange={event => update({ qrPayload: event.target.value })}
          aria-describedby="transfer-handles-qr-payload-help"
        />
        <p id="transfer-handles-qr-payload-help" className="mt-1 text-xs text-secondary-600">
          {t('operations:payments.transferHandles.qrPayloadHelp')}
        </p>
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={draft === null || hasBlank || mutation.isPending}
          data-testid="transfer-handles-save"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {mutation.isPending
            ? t('operations:payments.settings.form.saving')
            : t('operations:payments.transferHandles.save')}
        </Button>
      </div>
    </form>
  );
}
