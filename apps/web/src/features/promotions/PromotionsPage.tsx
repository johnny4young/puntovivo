import { useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { CalendarClock, Pencil, Plus, Search, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { TablePagination } from '@/components/tables/TablePagination';
import { Badge } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

type PromotionStatus = 'draft' | 'active' | 'paused' | 'archived';
type PromotionTargetKind = 'all' | 'product' | 'category';

interface PromotionRecord {
  id: string;
  name: string;
  status: PromotionStatus;
  discountPct: number;
  siteId: string | null;
  siteName: string | null;
  productId: string | null;
  productName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  customerId: string | null;
  customerName: string | null;
  minQuantity: number;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  combinable: boolean;
  source: 'manual' | 'expiry';
  sourceLotId: string | null;
  version: number;
}

interface PromotionDraft {
  name: string;
  discountPct: number;
  siteId: string;
  targetKind: PromotionTargetKind;
  productId: string;
  productName: string;
  categoryId: string;
  customerId: string;
  customerName: string;
  minQuantity: number;
  startsAt: string;
  endsAt: string;
  priority: number;
  combinable: boolean;
}

const EMPTY_DRAFT: PromotionDraft = {
  name: '',
  discountPct: 10,
  siteId: '',
  targetKind: 'all',
  productId: '',
  productName: '',
  categoryId: '',
  customerId: '',
  customerName: '',
  minQuantity: 1,
  startsAt: '',
  endsAt: '',
  priority: 0,
  combinable: false,
};

const PROMOTIONS_PAGE_SIZE = 20;

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromRecord(record: PromotionRecord): PromotionDraft {
  return {
    name: record.name,
    discountPct: record.discountPct,
    siteId: record.siteId ?? '',
    targetKind: record.productId ? 'product' : record.categoryId ? 'category' : 'all',
    productId: record.productId ?? '',
    productName: record.productName ?? '',
    categoryId: record.categoryId ?? '',
    customerId: record.customerId ?? '',
    customerName: record.customerName ?? '',
    minQuantity: record.minQuantity,
    startsAt: toLocalDateTime(record.startsAt),
    endsAt: toLocalDateTime(record.endsAt),
    priority: record.priority,
    combinable: record.combinable,
  };
}

function statusVariant(status: PromotionStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'paused') return 'warning';
  if (status === 'archived') return 'danger';
  return 'neutral';
}

export function PromotionsPage() {
  const { t } = useTranslation(['promotions', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<PromotionStatus | 'all'>('all');
  const [pageIndex, setPageIndex] = useState(0);
  const [editing, setEditing] = useState<PromotionRecord | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [draft, setDraft] = useState<PromotionDraft>(EMPTY_DRAFT);
  const [productQuery, setProductQuery] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const debouncedProductQuery = useDebouncedValue(productQuery.trim(), 200);
  const debouncedCustomerQuery = useDebouncedValue(customerQuery.trim(), 200);

  const listQuery = trpc.promotions.list.useQuery(
    {
      page: pageIndex + 1,
      perPage: PROMOTIONS_PAGE_SIZE,
      ...(status === 'all' ? {} : { status }),
    },
    { placeholderData: keepPreviousData }
  );
  const categoriesQuery = trpc.categories.tree.useQuery();
  const sitesQuery = trpc.sites.list.useQuery();
  const productSearch = trpc.products.search.useQuery(
    { q: debouncedProductQuery || '_', limit: 10, isActive: true },
    { enabled: isFormOpen && draft.targetKind === 'product' && debouncedProductQuery.length > 0 }
  );
  const customerSearch = trpc.customers.search.useQuery(
    { q: debouncedCustomerQuery || '_', limit: 10 },
    { enabled: isFormOpen && debouncedCustomerQuery.length > 0 }
  );

  const rows = (listQuery.data?.items ?? []) as PromotionRecord[];
  const categories = categoriesQuery.data?.items ?? [];
  const sites = sitesQuery.data?.items ?? [];
  const productResults = productSearch.data?.items ?? [];
  const customerResults = customerSearch.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PROMOTIONS_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : pageIndex * PROMOTIONS_PAGE_SIZE + 1;
  const rangeEnd = Math.min((pageIndex + 1) * PROMOTIONS_PAGE_SIZE, total);

  const invalidate = async () => {
    await utils.promotions.list.invalidate();
  };
  const refreshFirstPage = async () => {
    // Lifecycle transitions can remove the final row from a status-filtered
    // page. Return to the first page before refreshing so the operator never
    // lands on an out-of-range page after a successful mutation.
    setPageIndex(0);
    await invalidate();
  };
  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setProductQuery('');
    setCustomerQuery('');
  };

  const createMutation = trpc.promotions.create.useMutation({
    onSuccess: async () => {
      await refreshFirstPage();
      closeForm();
      toast.success({ title: t('promotions:toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'promotions:toast.saveError' }),
  });
  const updateMutation = trpc.promotions.update.useMutation({
    onSuccess: async () => {
      await refreshFirstPage();
      closeForm();
      toast.success({ title: t('promotions:toast.updated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'promotions:toast.saveError' }),
  });
  const transitionMutation = trpc.promotions.transition.useMutation({
    onSuccess: async (_result, variables) => {
      await refreshFirstPage();
      toast.success({ title: t(`promotions:toast.${variables.status}`) });
    },
    onError: onErrorToast(toast, t, { titleKey: 'promotions:toast.transitionError' }),
  });

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setIsFormOpen(true);
  };
  const openEdit = (record: PromotionRecord) => {
    setEditing(record);
    setDraft(fromRecord(record));
    setProductQuery(record.productName ?? '');
    setCustomerQuery(record.customerName ?? '');
    setIsFormOpen(true);
  };

  const formIsValid = useMemo(
    () =>
      draft.name.trim().length > 0 &&
      draft.discountPct > 0 &&
      draft.discountPct <= 100 &&
      draft.minQuantity > 0 &&
      (draft.targetKind !== 'product' || draft.productId.length > 0) &&
      (draft.targetKind !== 'category' || draft.categoryId.length > 0) &&
      (!draft.startsAt || !draft.endsAt || draft.startsAt < draft.endsAt) &&
      // A typed-but-unselected customer search is NOT the same as no
      // targeting. Typing clears customerId, so saving here would send null
      // and silently turn an intended targeted promotion into an
      // all-customer one. Either the box is empty, or a customer is picked.
      (customerQuery.trim().length === 0 || draft.customerId.length > 0),
    [draft, customerQuery]
  );

  const save = async () => {
    if (!formIsValid) return;
    const rule = {
      name: draft.name.trim(),
      discountPct: draft.discountPct,
      siteId: draft.siteId || null,
      productId: draft.targetKind === 'product' ? draft.productId : null,
      categoryId: draft.targetKind === 'category' ? draft.categoryId : null,
      customerId: draft.customerId || null,
      minQuantity: draft.minQuantity,
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
      priority: draft.priority,
      combinable: draft.combinable,
    };
    if (editing) {
      await updateMutation.mutateAsync({ id: editing.id, version: editing.version, ...rule });
    } else {
      await createMutation.mutateAsync(rule);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5" data-testid="promotions-page">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pv-kicker">{t('promotions:kicker')}</p>
          <h1 className="pv-title mt-1 text-3xl">{t('promotions:title')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-fg3">{t('promotions:description')}</p>
        </div>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          onClick={openCreate}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('promotions:create')}
        </button>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('promotions:filter.label')}>
        {(['all', 'draft', 'active', 'paused', 'archived'] as const).map(option => (
          <button
            key={option}
            type="button"
            className={status === option ? 'btn-primary' : 'btn-secondary'}
            aria-pressed={status === option}
            onClick={() => {
              setStatus(option);
              setPageIndex(0);
            }}
          >
            {t(`promotions:filter.${option}`)}
          </button>
        ))}
      </div>

      {listQuery.isLoading && <p role="status">{t('promotions:loading')}</p>}
      {listQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 p-4" role="alert">
          <p>{t('promotions:error')}</p>
          <button
            type="button"
            className="btn-secondary mt-2"
            onClick={() => void listQuery.refetch()}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      )}
      {!listQuery.isLoading && !listQuery.error && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
          <Tag className="mx-auto h-8 w-8 text-fg3" aria-hidden="true" />
          <p className="mt-3 font-medium">{t('promotions:empty.title')}</p>
          <p className="mt-1 text-sm text-fg3">{t('promotions:empty.description')}</p>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {rows.map(record => {
          const target =
            record.productName ?? record.categoryName ?? t('promotions:targets.allProducts');
          const scope = record.siteName ?? t('promotions:targets.allSites');
          return (
            <article key={record.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-fg">{record.name}</h2>
                    <Badge variant={statusVariant(record.status)}>
                      {t(`promotions:status.${record.status}`)}
                    </Badge>
                    {record.source === 'expiry' && (
                      <Badge variant="warning">{t('promotions:source.expiry')}</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-2xl font-semibold text-primary-700">
                    {t('promotions:discount', { value: record.discountPct })}
                  </p>
                </div>
                {record.source === 'manual' && ['draft', 'paused'].includes(record.status) && (
                  <button
                    type="button"
                    className="btn-ghost btn-icon"
                    onClick={() => openEdit(record)}
                    aria-label={t('promotions:edit')}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-fg3">{t('promotions:fields.target')}</dt>
                  <dd className="font-medium">{target}</dd>
                </div>
                <div>
                  <dt className="text-fg3">{t('promotions:fields.site')}</dt>
                  <dd className="font-medium">{scope}</dd>
                </div>
                <div>
                  <dt className="text-fg3">{t('promotions:fields.customer')}</dt>
                  <dd className="font-medium">
                    {record.customerName ?? t('promotions:targets.allCustomers')}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg3">{t('promotions:fields.minimum')}</dt>
                  <dd className="font-medium">{record.minQuantity}</dd>
                </div>
              </dl>
              {(record.startsAt || record.endsAt) && (
                <p className="mt-3 flex items-center gap-2 text-xs text-fg3">
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  {t('promotions:window', {
                    start: record.startsAt ? new Date(record.startsAt).toLocaleString() : '—',
                    end: record.endsAt ? new Date(record.endsAt).toLocaleString() : '—',
                  })}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {(record.status === 'draft' || record.status === 'paused') && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={transitionMutation.isPending}
                    onClick={() =>
                      transitionMutation.mutate({
                        id: record.id,
                        version: record.version,
                        status: 'active',
                      })
                    }
                  >
                    {t('promotions:actions.activate')}
                  </button>
                )}
                {record.status === 'active' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={transitionMutation.isPending}
                    onClick={() =>
                      transitionMutation.mutate({
                        id: record.id,
                        version: record.version,
                        status: 'paused',
                      })
                    }
                  >
                    {t('promotions:actions.pause')}
                  </button>
                )}
                {record.status !== 'archived' && (
                  <button
                    type="button"
                    className="btn-ghost text-danger-600"
                    disabled={transitionMutation.isPending}
                    onClick={() =>
                      transitionMutation.mutate({
                        id: record.id,
                        version: record.version,
                        status: 'archived',
                      })
                    }
                  >
                    {t('promotions:actions.archive')}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <TablePagination
        page={pageIndex}
        pageCount={pageCount}
        total={total}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onPageChange={setPageIndex}
      />

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editing ? t('promotions:form.editTitle') : t('promotions:form.createTitle')}
        size="xl"
        footer={
          <>
            <ModalButton onClick={closeForm} disabled={isSaving}>
              {t('common:actions.cancel')}
            </ModalButton>
            <ModalButton
              variant="primary"
              onClick={() => void save()}
              disabled={!formIsValid || isSaving}
            >
              {isSaving ? t('common:actions.saving') : t('common:actions.save')}
            </ModalButton>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="label">{t('promotions:fields.name')}</span>
            <input
              className="input mt-1"
              maxLength={120}
              value={draft.name}
              onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label>
            <span className="label">{t('promotions:fields.discount')}</span>
            <input
              className="input mt-1"
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={draft.discountPct}
              onChange={event =>
                setDraft(current => ({ ...current, discountPct: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            <span className="label">{t('promotions:fields.minimum')}</span>
            <input
              className="input mt-1"
              type="number"
              min={0.001}
              step={0.001}
              value={draft.minQuantity}
              onChange={event =>
                setDraft(current => ({ ...current, minQuantity: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            <span className="label">{t('promotions:fields.site')}</span>
            <select
              className="input mt-1"
              value={draft.siteId}
              onChange={event => setDraft(current => ({ ...current, siteId: event.target.value }))}
            >
              <option value="">{t('promotions:targets.allSites')}</option>
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">{t('promotions:fields.target')}</span>
            <select
              className="input mt-1"
              value={draft.targetKind}
              onChange={event =>
                setDraft(current => ({
                  ...current,
                  targetKind: event.target.value as PromotionTargetKind,
                  productId: '',
                  productName: '',
                  categoryId: '',
                }))
              }
            >
              <option value="all">{t('promotions:targets.allProducts')}</option>
              <option value="product">{t('promotions:targets.product')}</option>
              <option value="category">{t('promotions:targets.category')}</option>
            </select>
          </label>

          {draft.targetKind === 'product' && (
            <div className="relative sm:col-span-2">
              <label>
                <span className="label">{t('promotions:fields.product')}</span>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-fg3" aria-hidden="true" />
                  <input
                    className="input pl-9"
                    value={productQuery}
                    placeholder={t('promotions:form.searchProduct')}
                    onChange={event => {
                      setProductQuery(event.target.value);
                      setDraft(current => ({ ...current, productId: '', productName: '' }));
                    }}
                  />
                </div>
              </label>
              {productResults.length > 0 && !draft.productId && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
                  {productResults.map(product => (
                    <button
                      key={product.id}
                      type="button"
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        setDraft(current => ({
                          ...current,
                          productId: product.id,
                          productName: product.name,
                        }));
                        setProductQuery(product.name);
                      }}
                    >
                      {product.name} · {product.sku}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {draft.targetKind === 'category' && (
            <label className="sm:col-span-2">
              <span className="label">{t('promotions:fields.category')}</span>
              <select
                className="input mt-1"
                value={draft.categoryId}
                onChange={event =>
                  setDraft(current => ({ ...current, categoryId: event.target.value }))
                }
              >
                <option value="">{t('promotions:form.chooseCategory')}</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="relative sm:col-span-2">
            <label>
              <span className="label">{t('promotions:fields.customer')}</span>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-fg3" aria-hidden="true" />
                <input
                  className="input pl-9"
                  value={customerQuery}
                  placeholder={t('promotions:form.allCustomers')}
                  onChange={event => {
                    setCustomerQuery(event.target.value);
                    setDraft(current => ({ ...current, customerId: '', customerName: '' }));
                  }}
                />
              </div>
            </label>
            {customerQuery.trim().length > 0 && !draft.customerId && (
              <p className="mt-1 text-xs text-warning-700">
                {t('promotions:form.selectCustomerOrClear')}
              </p>
            )}
            {customerResults.length > 0 && !draft.customerId && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
                {customerResults.map(customer => (
                  <button
                    key={customer.id}
                    type="button"
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      setDraft(current => ({
                        ...current,
                        customerId: customer.id,
                        customerName: customer.name,
                      }));
                      setCustomerQuery(customer.name);
                    }}
                  >
                    {customer.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label>
            <span className="label">{t('promotions:fields.startsAt')}</span>
            <input
              className="input mt-1"
              type="datetime-local"
              value={draft.startsAt}
              onChange={event =>
                setDraft(current => ({ ...current, startsAt: event.target.value }))
              }
            />
          </label>
          <label>
            <span className="label">{t('promotions:fields.endsAt')}</span>
            <input
              className="input mt-1"
              type="datetime-local"
              value={draft.endsAt}
              onChange={event => setDraft(current => ({ ...current, endsAt: event.target.value }))}
            />
          </label>
          <label>
            <span className="label">{t('promotions:fields.priority')}</span>
            <input
              className="input mt-1"
              type="number"
              min={-10000}
              max={10000}
              value={draft.priority}
              onChange={event =>
                setDraft(current => ({ ...current, priority: Number(event.target.value) }))
              }
            />
          </label>
          <label className="flex items-center gap-3 self-end rounded-xl border border-line p-3">
            <input
              type="checkbox"
              checked={draft.combinable}
              onChange={event =>
                setDraft(current => ({ ...current, combinable: event.target.checked }))
              }
            />
            <span>
              <span className="block text-sm font-medium">{t('promotions:fields.combinable')}</span>
              <span className="block text-xs text-fg3">
                {t('promotions:fields.combinableHelp')}
              </span>
            </span>
          </label>
        </div>
        {editing?.source === 'expiry' && (
          <p className="mt-4 text-sm text-warning-700">{t('promotions:form.expiryReadOnly')}</p>
        )}
      </Modal>
    </div>
  );
}
