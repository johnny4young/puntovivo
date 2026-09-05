import { useEffect, useMemo, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { Check, ClipboardCheck, RefreshCw, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { TablePagination } from '@/components/tables/TablePagination';
import { Badge, Button } from '@/components/ui';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type { Provider } from '@/types';

/**
 * What the blind-count picker is allowed to know: how to find and identify a
 * product, and whether it is eligible for a manual count. No stock figures —
 * the whole point of the count is that the counter does not have them.
 */
interface CountableProduct {
  productId: string;
  productName: string;
  productSku: string;
  tracksLots: boolean | null;
  tracksSerials: boolean | null;
  catalogType: string | null;
}

type RouterOutputs = inferRouterOutputs<AppRouter>;
type CountSession = RouterOutputs['inventory']['getCountSession'];
type CountSessionSummary = RouterOutputs['inventory']['listCountSessions']['items'][number];
type ReplenishmentSuggestion =
  RouterOutputs['inventory']['listReplenishmentSuggestions']['items'][number];

interface InventoryControlPanelProps {
  currentSite: { id: string; name: string } | null;
}

type InventorySite = NonNullable<InventoryControlPanelProps['currentSite']>;

const countStatusTone = {
  counting: 'info',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
} as const;

// A store-scale catalog can contain tens of thousands of balances. Keep the
// searchable source in query memory, but never mount an unbounded checkbox DOM
// when the operator opens a count. Selection persists while the search changes.
const COUNT_PRODUCT_RENDER_LIMIT = 100;

function CountCreateModal({
  isOpen,
  siteName,
  balances,
  balancesLoading,
  balancesError,
  isSaving,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  siteName: string;
  /**
   * Identity + eligibility metadata ONLY. This list must never carry onHand
   * or reserved: it feeds a BLIND count, and anything sent here sits in the
   * tRPC cache where the counter can read it before submitting.
   */
  balances: CountableProduct[];
  balancesLoading: boolean;
  balancesError: string | null;
  isSaving: boolean;
  onClose: () => void;
  onCreate: (productIds: string[], notes: string | undefined) => Promise<void>;
}) {
  const { t } = useTranslation('inventoryControls');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');

  const filtered = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return balances.filter(item => {
      if (!normalized) return true;
      return (
        item.productName.toLocaleLowerCase().includes(normalized) ||
        item.productSku.toLocaleLowerCase().includes(normalized)
      );
    });
  }, [balances, search]);
  const visibleProducts = filtered.slice(0, COUNT_PRODUCT_RENDER_LIMIT);

  const isEligible = (item: CountableProduct) =>
    item.tracksLots !== true &&
    item.tracksSerials !== true &&
    (item.catalogType ?? 'standard') !== 'variant_parent';

  const toggle = (productId: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('count.createTitle')}
      size="lg"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('actions.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            disabled={selected.size === 0 || isSaving}
            onClick={() => void onCreate([...selected], notes.trim() || undefined)}
          >
            {isSaving ? t('actions.saving') : t('count.start')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-info-200 bg-info-50 p-4 text-sm text-info-900">
          <p className="font-medium">{t('count.blindTitle')}</p>
          <p className="mt-1">{t('count.blindDescription', { site: siteName })}</p>
        </div>
        <div className="pv-field">
          <label className="label" htmlFor="inventory-count-search">
            {t('count.searchLabel')}
          </label>
          <input
            id="inventory-count-search"
            className="pv-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={t('count.searchPlaceholder')}
          />
        </div>
        <div className="max-h-80 overflow-auto rounded-xl border border-secondary-200">
          {balancesError ? (
            <p role="alert" className="p-4 text-sm text-danger-700">
              {balancesError}
            </p>
          ) : balancesLoading ? (
            <p className="p-4 text-sm text-secondary-500">{t('count.loadingProducts')}</p>
          ) : (
            <ul className="divide-y divide-secondary-200">
              {visibleProducts.map(item => {
                const eligible = isEligible(item);
                return (
                  <li key={item.productId} className="flex items-start gap-3 p-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={selected.has(item.productId)}
                      disabled={!eligible}
                      onChange={() => toggle(item.productId)}
                      aria-label={t('count.selectProduct', { name: item.productName })}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-secondary-900">{item.productName}</p>
                      <p className="text-xs text-secondary-500">{item.productSku}</p>
                      {!eligible && (
                        <p className="mt-1 text-xs text-warning-800">
                          {t('count.identityWorkflowRequired')}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {filtered.length > COUNT_PRODUCT_RENDER_LIMIT && (
          <p className="text-xs text-secondary-600" aria-live="polite">
            {t('count.resultLimit', { count: COUNT_PRODUCT_RENDER_LIMIT })}
          </p>
        )}
        <div className="pv-field">
          <label className="label" htmlFor="inventory-count-notes">
            {t('count.notes')}
          </label>
          <textarea
            id="inventory-count-notes"
            className="pv-input min-h-20"
            value={notes}
            onChange={event => setNotes(event.target.value)}
            placeholder={t('count.notesPlaceholder')}
          />
        </div>
      </div>
    </Modal>
  );
}

function CountSessionModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation(['inventoryControls', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
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
                      {t('inventoryControls:count.variance')}
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
                    </td>
                    {session.status !== 'counting' && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        {line.expectedQuantity?.toLocaleString()}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      {session.status === 'counting' ? (
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

function ReplenishmentTable({
  items,
  selected,
  quantities,
  onToggle,
  onQuantity,
}: {
  items: ReplenishmentSuggestion[];
  selected: Set<string>;
  quantities: Record<string, string>;
  onToggle: (item: ReplenishmentSuggestion) => void;
  onQuantity: (productId: string, value: string) => void;
}) {
  const { t } = useTranslation('inventoryControls');
  return (
    <div className="overflow-x-auto rounded-xl border border-secondary-200">
      <table className="min-w-full divide-y divide-secondary-200 text-sm">
        <thead className="bg-secondary-50 text-left text-xs uppercase text-secondary-500">
          <tr>
            <th className="w-12 px-4 py-3">
              <span className="sr-only">{t('replenishment.select')}</span>
            </th>
            <th className="px-4 py-3">{t('replenishment.product')}</th>
            <th className="px-4 py-3 text-right">{t('replenishment.available')}</th>
            <th className="px-4 py-3 text-right">{t('replenishment.onOrder')}</th>
            <th className="px-4 py-3 text-right">{t('replenishment.minimum')}</th>
            <th className="px-4 py-3 text-right">{t('replenishment.suggested')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-secondary-200 bg-white">
          {items.map(item => (
            <tr key={item.productId}>
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selected.has(item.productId)}
                  disabled={!item.canDraft}
                  onChange={() => onToggle(item)}
                  aria-label={t('replenishment.selectProduct', {
                    name: item.productName,
                  })}
                />
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-secondary-900">{item.productName}</p>
                <p className="text-xs text-secondary-500">{item.productSku}</p>
                {item.blockedReason && (
                  <p className="mt-1 text-xs text-warning-800">
                    {t(`replenishment.blocked.${item.blockedReason}`)}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {item.available.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{item.onOrder.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {item.minStock.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  className="pv-input ml-auto w-28 text-right tabular-nums"
                  disabled={!selected.has(item.productId)}
                  value={quantities[item.productId] ?? String(item.suggestedQuantity)}
                  onChange={event => onQuantity(item.productId, event.target.value)}
                  aria-label={t('replenishment.quantityFor', { name: item.productName })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SiteInventoryControlPanel({ currentSite }: { currentSite: InventorySite }) {
  const { t } = useTranslation(['inventoryControls', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isCreateCountOpen, setIsCreateCountOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [countPage, setCountPage] = useState(1);
  const [suggestionPage, setSuggestionPage] = useState(1);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [suggestedQuantities, setSuggestedQuantities] = useState<Record<string, string>>({});
  const [providerId, setProviderId] = useState('');

  const siteId = currentSite.id;
  // Identity-only picker feed. Reusing listBalancesBySite here shipped onHand
  // and reserved into the counter's browser cache while the UI claimed the
  // expected quantity was server-redacted.
  const balancesQuery = trpc.inventory.listCountableProducts.useQuery(
    { siteId },
    { enabled: isCreateCountOpen && siteId.length > 0 }
  );
  const sessionsQuery = trpc.inventory.listCountSessions.useQuery(
    { page: countPage, perPage: 25, siteId: siteId || undefined },
    { enabled: siteId.length > 0 }
  );
  const suggestionsQuery = trpc.inventory.listReplenishmentSuggestions.useQuery(
    { page: suggestionPage, perPage: 100, siteId },
    { enabled: siteId.length > 0 }
  );
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });

  const createCountMutation = useCriticalMutation('inventory.createCountSession', {
    onSuccess: async data => {
      await utils.inventory.listCountSessions.invalidate();
      setCountPage(1);
      setIsCreateCountOpen(false);
      setActiveSessionId(data.id);
      toast.success({ title: t('inventoryControls:count.toast.createSuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'inventoryControls:count.toast.createError',
    }),
  });
  const createDraftMutation = useCriticalMutation('orders.create', {
    onSuccess: async data => {
      await Promise.all([
        utils.orders.list.invalidate(),
        utils.orders.getById.invalidate({ id: data.id }),
        utils.inventory.listReplenishmentSuggestions.invalidate(),
      ]);
      setSelectedSuggestions(new Set());
      setSuggestedQuantities({});
      setProviderId('');
      setSuggestionPage(1);
      toast.success({
        title: t('inventoryControls:replenishment.toast.success'),
        description: t('inventoryControls:replenishment.toast.successDetail', {
          number: data.orderNumber,
        }),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'inventoryControls:replenishment.toast.error',
    }),
  });

  const sessions = (sessionsQuery.data?.items ?? []) as CountSessionSummary[];
  const suggestions = (suggestionsQuery.data?.items ?? []) as ReplenishmentSuggestion[];
  const countTotal = sessionsQuery.data?.totalItems ?? sessions.length;
  const countPageCount = sessionsQuery.data?.totalPages ?? 1;
  const suggestionTotal = suggestionsQuery.data?.totalItems ?? suggestions.length;
  const suggestionPageCount = suggestionsQuery.data?.totalPages ?? 1;
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );
  const balancesError = balancesQuery.error
    ? translateServerError(balancesQuery.error, t, t('inventoryControls:errors.products'))
    : null;

  const toggleSuggestion = (item: ReplenishmentSuggestion) => {
    if (!item.canDraft) return;
    setSelectedSuggestions(current => {
      const next = new Set(current);
      if (next.has(item.productId)) next.delete(item.productId);
      else next.add(item.productId);
      return next;
    });
    setSuggestedQuantities(current => ({
      ...current,
      [item.productId]: current[item.productId] ?? String(item.suggestedQuantity),
    }));
  };

  const selectedDraftItems = suggestions
    .filter(item => item.canDraft && selectedSuggestions.has(item.productId))
    .map(item => ({
      productId: item.productId,
      unitId: item.unitId,
      quantity: Number(suggestedQuantities[item.productId] ?? item.suggestedQuantity),
      costPerUnit: item.initialCost,
    }));
  const validDraft =
    providerId.length > 0 &&
    selectedDraftItems.length > 0 &&
    selectedDraftItems.every(item => Number.isFinite(item.quantity) && item.quantity > 0);
  const draftTotal = selectedDraftItems.reduce(
    (sum, item) => sum + item.quantity * item.costPerUnit,
    0
  );

  return (
    <div className="space-y-6">
      <section className="card p-6" aria-labelledby="inventory-counts-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="inventory-counts-title" className="text-lg font-semibold text-secondary-900">
              {t('inventoryControls:count.title')}
            </h2>
            <p className="mt-1 text-sm text-secondary-600">
              {t('inventoryControls:count.description')}
            </p>
          </div>
          <Button
            variant="primary"
            className="flex items-center gap-2"
            onClick={() => setIsCreateCountOpen(true)}
          >
            <ClipboardCheck className="h-4 w-4" />
            {t('inventoryControls:count.new')}
          </Button>
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-secondary-200">
          {sessionsQuery.error ? (
            <p role="alert" className="p-4 text-sm text-danger-700">
              {translateServerError(sessionsQuery.error, t, t('inventoryControls:errors.counts'))}
            </p>
          ) : sessionsQuery.isLoading ? (
            <p className="p-4 text-sm text-secondary-500">{t('inventoryControls:count.loading')}</p>
          ) : sessions.length === 0 ? (
            <p className="p-4 text-sm text-secondary-500">{t('inventoryControls:count.empty')}</p>
          ) : (
            <table className="min-w-full divide-y divide-secondary-200 text-sm">
              <thead className="bg-secondary-50 text-left text-xs uppercase text-secondary-500">
                <tr>
                  <th className="px-4 py-3">{t('inventoryControls:count.created')}</th>
                  <th className="px-4 py-3">{t('inventoryControls:count.status')}</th>
                  <th className="px-4 py-3 text-right">{t('inventoryControls:count.progress')}</th>
                  <th className="px-4 py-3 text-right">{t('inventoryControls:count.variance')}</th>
                  <th className="px-4 py-3 text-right">{t('inventoryControls:count.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-200 bg-white">
                {sessions.map(session => (
                  <tr key={session.id}>
                    <td className="px-4 py-3">{formatDateTime(session.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={countStatusTone[session.status]}>
                        {t(`inventoryControls:count.statuses.${session.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {session.countedLineCount}/{session.lineCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {session.discrepancyLineCount ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-ghost h-8 px-3 text-xs"
                        onClick={() => setActiveSessionId(session.id)}
                      >
                        {t('inventoryControls:count.open')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="mt-3">
          <TablePagination
            page={countPage - 1}
            pageCount={countPageCount}
            total={countTotal}
            rangeStart={(countPage - 1) * 25 + 1}
            rangeEnd={Math.min(countPage * 25, countTotal)}
            onPageChange={page => setCountPage(page + 1)}
          />
        </div>
      </section>

      <section className="card p-6" aria-labelledby="inventory-replenishment-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="inventory-replenishment-title"
              className="text-lg font-semibold text-secondary-900"
            >
              {t('inventoryControls:replenishment.title')}
            </h2>
            <p className="mt-1 text-sm text-secondary-600">
              {t('inventoryControls:replenishment.description')}
            </p>
          </div>
          <Button
            variant="secondary"
            className="flex items-center gap-2"
            onClick={() => void suggestionsQuery.refetch()}
            disabled={suggestionsQuery.isFetching}
          >
            <RefreshCw className="h-4 w-4" />
            {t('inventoryControls:replenishment.refresh')}
          </Button>
        </div>

        <div className="mt-5 space-y-4">
          {suggestionsQuery.error ? (
            <p role="alert" className="text-sm text-danger-700">
              {translateServerError(
                suggestionsQuery.error,
                t,
                t('inventoryControls:errors.suggestions')
              )}
            </p>
          ) : suggestionsQuery.isLoading ? (
            <p className="text-sm text-secondary-500">
              {t('inventoryControls:replenishment.loading')}
            </p>
          ) : suggestions.length === 0 ? (
            <div className="rounded-xl border border-success-200 bg-success-50 p-4 text-sm text-success-900">
              <Check className="mr-2 inline h-4 w-4" />
              {t('inventoryControls:replenishment.empty')}
            </div>
          ) : (
            <ReplenishmentTable
              items={suggestions}
              selected={selectedSuggestions}
              quantities={suggestedQuantities}
              onToggle={toggleSuggestion}
              onQuantity={(productId, value) =>
                setSuggestedQuantities(current => ({ ...current, [productId]: value }))
              }
            />
          )}

          <TablePagination
            page={suggestionPage - 1}
            pageCount={suggestionPageCount}
            total={suggestionTotal}
            rangeStart={(suggestionPage - 1) * 100 + 1}
            rangeEnd={Math.min(suggestionPage * 100, suggestionTotal)}
            onPageChange={page => {
              setSuggestionPage(page + 1);
              setSelectedSuggestions(new Set());
              setSuggestedQuantities({});
              setProviderId('');
            }}
          />

          {selectedDraftItems.length > 0 && (
            <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                <div className="pv-field">
                  <label className="label" htmlFor="replenishment-provider">
                    {t('inventoryControls:replenishment.provider')}
                  </label>
                  <select
                    id="replenishment-provider"
                    className="pv-input"
                    value={providerId}
                    onChange={event => setProviderId(event.target.value)}
                    disabled={providersQuery.isLoading || !!providersQuery.error}
                  >
                    <option value="">{t('inventoryControls:replenishment.selectProvider')}</option>
                    {providers.map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                  {providersQuery.error && (
                    <p role="alert" className="mt-1 text-xs text-danger-700">
                      {translateServerError(
                        providersQuery.error,
                        t,
                        t('inventoryControls:errors.providers')
                      )}
                    </p>
                  )}
                </div>
                <div className="text-sm md:text-right">
                  <p className="text-secondary-600">
                    {t('inventoryControls:replenishment.estimatedTotal')}
                  </p>
                  <p className="text-lg font-semibold text-primary-900">
                    {formatCurrency(draftTotal)}
                  </p>
                </div>
                <Button
                  variant="primary"
                  className="flex items-center gap-2"
                  disabled={!validDraft || createDraftMutation.isPending}
                  onClick={() =>
                    createDraftMutation.mutate({
                      providerId,
                      status: 'draft',
                      items: selectedDraftItems,
                      notes: t('inventoryControls:replenishment.draftNote', {
                        site: currentSite.name,
                      }),
                    })
                  }
                >
                  <Send className="h-4 w-4" />
                  {t('inventoryControls:replenishment.createDraft')}
                </Button>
              </div>
              <p className="mt-3 text-xs text-primary-800">
                {t('inventoryControls:replenishment.explicitSubmitHelp')}
              </p>
            </div>
          )}
        </div>
      </section>

      {isCreateCountOpen && (
        <CountCreateModal
          isOpen
          siteName={currentSite.name}
          balances={balancesQuery.data?.items ?? []}
          balancesLoading={balancesQuery.isLoading}
          balancesError={balancesError}
          isSaving={createCountMutation.isPending}
          onClose={() => setIsCreateCountOpen(false)}
          onCreate={async (productIds, notes) => {
            try {
              await createCountMutation.mutateAsync({ siteId: currentSite.id, productIds, notes });
            } catch {
              // useCriticalMutation's onError owns localized operator feedback.
            }
          }}
        />
      )}
      {activeSessionId && (
        <CountSessionModal
          key={activeSessionId}
          sessionId={activeSessionId}
          onClose={() => setActiveSessionId(null)}
        />
      )}
    </div>
  );
}

export function InventoryControlPanel({ currentSite }: InventoryControlPanelProps) {
  const { t } = useTranslation('inventoryControls');

  if (!currentSite) {
    return (
      <div className="card p-6">
        <EmptyState
          icon={ClipboardCheck}
          title={t('noSiteTitle')}
          description={t('noSiteDescription')}
        />
      </div>
    );
  }

  return <SiteInventoryControlPanel key={currentSite.id} currentSite={currentSite} />;
}
