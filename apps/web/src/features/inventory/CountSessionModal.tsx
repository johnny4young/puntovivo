import { useEffect, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Badge, Button } from '@/components/ui';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { cn, formatDateTime } from '@/lib/utils';
import { CountIdentityEditor, CountIdentityReview } from './CountIdentityEditor';
import { countStatusTone } from './countPresentation';

type CountSession = inferRouterOutputs<AppRouter>['inventory']['getCountSession'];

/** Lazy operator workflow: retain exact blind edits without loading them for stock browsing. */
export function CountSessionModal({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['inventoryControls', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [lotQuantities, setLotQuantities] = useState<Record<string, Record<string, string>>>({});
  const [serialText, setSerialText] = useState<Record<string, string>>({});
  const [emptySerialConfirmed, setEmptySerialConfirmed] = useState<Record<string, boolean>>({});
  const [rejectReason, setRejectReason] = useState('');
  const hydratedCountKeyRef = useRef<string | null>(null);

  const query = trpc.inventory.getCountSession.useQuery({ id: sessionId });
  const session = query.data as CountSession | undefined;

  useEffect(() => {
    if (!session || session.status !== 'counting') {
      hydratedCountKeyRef.current = null;
      return;
    }
    const hydrationKey = `${session.id}:${session.version}`;
    if (hydratedCountKeyRef.current === hydrationKey) return;
    hydratedCountKeyRef.current = hydrationKey;
    setLotQuantities(
      Object.fromEntries(
        session.lines.map(line => [
          line.id,
          Object.fromEntries(
            (line.identities ?? []).map(identity => [
              identity.code,
              identity.countedQuantity === null ? '' : String(identity.countedQuantity),
            ])
          ),
        ])
      )
    );
    setSerialText(
      Object.fromEntries(
        session.lines.map(line => [
          line.id,
          (line.identities ?? [])
            .filter(identity => identity.countedQuantity === 1)
            .map(identity => identity.code)
            .join('\n'),
        ])
      )
    );
    setEmptySerialConfirmed(
      Object.fromEntries(
        session.lines.map(line => [
          line.id,
          line.trackingMode === 'serials' && line.countedQuantity === 0,
        ])
      )
    );
    setQuantities(
      Object.fromEntries(
        session.lines.map(line => [
          line.id,
          line.countedQuantity === null ? '' : String(line.countedQuantity),
        ])
      )
    );
  }, [session]);

  const invalidate = async (id: string) => {
    await Promise.all([
      utils.inventory.getCountSession.invalidate({ id }),
      utils.inventory.listCountSessions.invalidate(),
      utils.inventory.listMovements.invalidate(),
      utils.inventory.listEntries.invalidate(),
      utils.inventory.listStock.invalidate(),
      utils.inventory.listBalancesBySite.invalidate(),
      utils.inventory.listReplenishmentSuggestions.invalidate(),
      utils.products.list.invalidate(),
      utils.products.search.invalidate(),
      utils.productSerials.list.invalidate(),
      utils.productSerials.lookup.invalidate(),
      utils.inventoryLots.list.invalidate(),
      utils.inventoryLots.expiring.invalidate(),
    ]);
  };

  const saveMutation = useCriticalMutation('inventory.saveCountSession', {
    onError: onErrorToast(toast, t, {
      titleKey: 'inventoryControls:count.toast.saveError',
    }),
  });
  const submitMutation = useCriticalMutation('inventory.submitCountSession', {
    onSuccess: async data => {
      await invalidate(data.id);
      toast.success({ title: t('inventoryControls:count.toast.submitSuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'inventoryControls:count.toast.submitError',
    }),
  });
  const approveMutation = useCriticalMutation('inventory.approveCountSession', {
    onSuccess: async data => {
      await invalidate(data.id);
      toast.success({ title: t('inventoryControls:count.toast.approveSuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'inventoryControls:count.toast.approveError',
    }),
  });
  const rejectMutation = useCriticalMutation('inventory.rejectCountSession', {
    onSuccess: async data => {
      await invalidate(data.id);
      toast.success({ title: t('inventoryControls:count.toast.rejectSuccess') });
      setRejectReason('');
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'inventoryControls:count.toast.rejectError',
    }),
  });

  const isPending =
    saveMutation.isPending ||
    submitMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending;

  const buildSaveLines = (current: CountSession) =>
    current.lines.flatMap(line => {
      if (line.trackingMode === 'lots') {
        const observations = (line.identities ?? []).map(identity => ({
          code: identity.code,
          raw: lotQuantities[line.id]?.[identity.code] ?? '',
        }));
        if (
          observations.some(
            row => row.raw.trim() === '' || !Number.isFinite(Number(row.raw)) || Number(row.raw) < 0
          )
        )
          return [];
        const identities = observations.map(row => ({ code: row.code, quantity: Number(row.raw) }));
        return [
          {
            lineId: line.id,
            countedQuantity: identities.reduce((sum, row) => sum + row.quantity, 0),
            version: line.version,
            identities,
          },
        ];
      }
      if (line.trackingMode === 'serials') {
        const codes = (serialText[line.id] ?? '')
          .split(/\r?\n/)
          .map(code => code.trim())
          .filter(Boolean);
        if (codes.length === 0 && !emptySerialConfirmed[line.id]) return [];
        return [
          {
            lineId: line.id,
            countedQuantity: codes.length,
            version: line.version,
            identities: codes.map(code => ({ code, quantity: 1 })),
          },
        ];
      }
      const rawQuantity = quantities[line.id];
      if (rawQuantity === undefined || rawQuantity.trim() === '') return [];
      const countedQuantity = Number(rawQuantity);
      if (!Number.isFinite(countedQuantity) || countedQuantity < 0) return [];
      return [{ lineId: line.id, countedQuantity, version: line.version }];
    });

  const handleSave = async () => {
    if (!session || session.status !== 'counting') return;
    const lines = buildSaveLines(session);
    if (lines.length === 0) return;
    try {
      const saved = await saveMutation.mutateAsync({
        id: session.id,
        version: session.version,
        lines,
      });
      await invalidate(saved.id);
      toast.success({ title: t('inventoryControls:count.toast.saveSuccess') });
    } catch {
      // useCriticalMutation's onError owns localized operator feedback.
    }
  };

  const handleSubmit = async () => {
    if (!session || session.status !== 'counting') return;
    const lines = buildSaveLines(session);
    if (lines.length !== session.lines.length) return;
    try {
      const saved = await saveMutation.mutateAsync({
        id: session.id,
        version: session.version,
        lines,
      });
      await submitMutation.mutateAsync({ id: saved.id, version: saved.version });
    } catch {
      // The mutation handlers already surface the exact localized failure.
    }
  };

  const savableLineCount = session?.status === 'counting' ? buildSaveLines(session).length : 0;
  const allCounted =
    session?.status === 'counting' &&
    session.lines.length > 0 &&
    savableLineCount === session.lines.length;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('inventoryControls:count.sessionTitle')}
      size="full"
      footer={
        <>
          {session?.status === 'counting' && (
            <>
              <ModalButton
                onClick={() => void handleSave()}
                disabled={savableLineCount === 0 || isPending}
              >
                {t('inventoryControls:count.saveProgress')}
              </ModalButton>
              <ModalButton
                variant="primary"
                onClick={() => void handleSubmit()}
                disabled={!allCounted || isPending}
              >
                {t('inventoryControls:count.submitForReview')}
              </ModalButton>
            </>
          )}
          {session?.status === 'submitted' && (
            <ModalButton
              variant="primary"
              onClick={() => approveMutation.mutate({ id: session.id, version: session.version })}
              disabled={isPending}
            >
              {t('inventoryControls:count.approve')}
            </ModalButton>
          )}
          <ModalButton onClick={onClose}>{t('inventoryControls:actions.close')}</ModalButton>
        </>
      }
    >
      {query.isLoading && (
        <p className="text-sm text-secondary-500">{t('inventoryControls:count.loading')}</p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-danger-600">
          {translateServerError(query.error, t, t('errors:server.unknown'))}
        </p>
      )}
      {session && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-secondary-200 p-4">
              <p className="text-xs uppercase text-secondary-500">
                {t('inventoryControls:count.site')}
              </p>
              <p className="mt-1 font-medium">{session.siteName}</p>
            </div>
            <div className="rounded-xl border border-secondary-200 p-4">
              <p className="text-xs uppercase text-secondary-500">
                {t('inventoryControls:count.status')}
              </p>
              <Badge className="mt-2" variant={countStatusTone[session.status]}>
                {t(`inventoryControls:count.statuses.${session.status}`)}
              </Badge>
            </div>
            <div className="rounded-xl border border-secondary-200 p-4">
              <p className="text-xs uppercase text-secondary-500">
                {t('inventoryControls:count.progress')}
              </p>
              <p className="mt-1 font-medium">
                {session.countedLineCount}/{session.lineCount}
              </p>
            </div>
            <div className="rounded-xl border border-secondary-200 p-4">
              <p className="text-xs uppercase text-secondary-500">
                {t('inventoryControls:count.created')}
              </p>
              <p className="mt-1 font-medium">{formatDateTime(session.createdAt)}</p>
            </div>
          </div>

          {session.status === 'counting' && (
            <div className="rounded-xl border border-info-200 bg-info-50 p-4 text-sm text-info-900">
              <p className="font-medium">{t('inventoryControls:count.blindActive')}</p>
              <p className="mt-1">{t('inventoryControls:count.blindActiveHelp')}</p>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-secondary-200">
            <table className="min-w-full divide-y divide-secondary-200 text-sm">
              <thead className="bg-secondary-50 text-left text-xs uppercase text-secondary-500">
                <tr>
                  <th className="px-4 py-3">{t('inventoryControls:count.product')}</th>
                  {session.status !== 'counting' && (
                    <th className="px-4 py-3 text-right">
                      {t('inventoryControls:count.expected')}
                    </th>
                  )}
                  <th className="px-4 py-3 text-right">{t('inventoryControls:count.counted')}</th>
                  {session.status !== 'counting' && (
                    <th className="px-4 py-3 text-right">
                      {t('inventoryControls:count.netVariance')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-200 bg-white">
                {session.lines.map(line => (
                  <tr key={line.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-secondary-900">{line.productName}</p>
                      <p className="text-xs text-secondary-500">{line.productSku}</p>
                      {session.status !== 'counting' && (
                        <CountIdentityReview identities={line.identities ?? []} />
                      )}
                    </td>
                    {session.status !== 'counting' && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        {line.expectedQuantity?.toLocaleString()}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      {session.status === 'counting' &&
                      (line.trackingMode === 'lots' || line.trackingMode === 'serials') ? (
                        <CountIdentityEditor
                          name={line.productName}
                          mode={line.trackingMode}
                          identities={line.identities ?? []}
                          lotQuantities={lotQuantities[line.id] ?? {}}
                          serialText={serialText[line.id] ?? ''}
                          emptyConfirmed={emptySerialConfirmed[line.id] ?? false}
                          disabled={isPending}
                          onLotChange={(code, value) =>
                            setLotQuantities(current => ({
                              ...current,
                              [line.id]: { ...current[line.id], [code]: value },
                            }))
                          }
                          onSerialChange={value => {
                            setSerialText(current => ({ ...current, [line.id]: value }));
                            setEmptySerialConfirmed(current => ({ ...current, [line.id]: false }));
                          }}
                          onEmptyConfirmed={value =>
                            setEmptySerialConfirmed(current => ({ ...current, [line.id]: value }))
                          }
                        />
                      ) : session.status === 'counting' ? (
                        <input
                          className="pv-input ml-auto w-32 text-right tabular-nums"
                          type="number"
                          min="0"
                          step="0.001"
                          value={quantities[line.id] ?? ''}
                          onChange={event =>
                            setQuantities(current => ({
                              ...current,
                              [line.id]: event.target.value,
                            }))
                          }
                          aria-label={t('inventoryControls:count.quantityFor', {
                            name: line.productName,
                          })}
                        />
                      ) : (
                        line.countedQuantity?.toLocaleString()
                      )}
                    </td>
                    {session.status !== 'counting' && (
                      <td
                        className={cn(
                          'px-4 py-3 text-right font-medium tabular-nums',
                          (line.discrepancy ?? 0) < 0 && 'text-danger-700',
                          (line.discrepancy ?? 0) > 0 && 'text-success-700'
                        )}
                      >
                        {(line.discrepancy ?? 0) > 0 ? '+' : ''}
                        {line.discrepancy?.toLocaleString()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {session.status === 'submitted' && (
            <div className="rounded-xl border border-secondary-200 p-4">
              <label className="label" htmlFor="inventory-count-reject-reason">
                {t('inventoryControls:count.rejectReason')}
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="inventory-count-reject-reason"
                  className="pv-input flex-1"
                  value={rejectReason}
                  onChange={event => setRejectReason(event.target.value)}
                  placeholder={t('inventoryControls:count.rejectPlaceholder')}
                />
                <Button
                  variant="danger"
                  disabled={rejectReason.trim().length < 3 || isPending}
                  onClick={() =>
                    rejectMutation.mutate({
                      id: session.id,
                      version: session.version,
                      reason: rejectReason.trim(),
                    })
                  }
                >
                  {t('inventoryControls:count.reject')}
                </Button>
              </div>
            </div>
          )}

          {session.status === 'rejected' && session.rejectionReason && (
            <div className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-900">
              <p className="font-medium">{t('inventoryControls:count.rejectedReason')}</p>
              <p className="mt-1">{session.rejectionReason}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
