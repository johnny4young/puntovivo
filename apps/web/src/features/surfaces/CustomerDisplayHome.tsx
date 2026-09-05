import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MonitorUp, Radio, RefreshCw, ShoppingBag, WifiOff } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { useCustomerDisplayFeed } from './useCustomerDisplayFeed';
import { isCustomerDisplayAccessId } from './customerDisplayStorage';

/** Read-only, privacy-minimal cart mirror for a customer-facing second screen. */
export function CustomerDisplayHome() {
  const { t, i18n } = useTranslation('customerDisplay');
  const [searchParams] = useSearchParams();
  const rawAccessId = searchParams.get('access');
  const accessId = isCustomerDisplayAccessId(rawAccessId) ? rawAccessId : null;
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(null);
  const feed = useCustomerDisplayFeed(accessId, requestedSessionId);
  const assignments = feed.projections;
  const selectedAssignment =
    assignments.find(assignment => assignment.cashSessionId === feed.selectedSessionId) ?? null;
  const projection = feed.projection;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-soft backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-700">
            {t('eyebrow')}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-secondary-950">
            {selectedAssignment?.registerName ?? t('shell.product')}
          </h1>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-52 text-sm font-medium text-secondary-700">
            <span className="mb-1 block">{t('register.label')}</span>
            <select
              className="input min-h-12"
              value={feed.selectedSessionId ?? ''}
              onChange={event => setRequestedSessionId(event.target.value || null)}
              disabled={assignments.length === 0}
              data-testid="customer-display-register"
            >
              {assignments.length === 0 ? (
                <option value="">{t('register.none')}</option>
              ) : (
                assignments.map(assignment => (
                  <option key={assignment.cashSessionId} value={assignment.cashSessionId}>
                    {assignment.registerName}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            className="btn-outline min-h-12"
            onClick={() => {
              feed.reconnect();
            }}
            data-testid="customer-display-reconnect"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('actions.reconnect')}
          </button>
        </div>
      </header>

      {feed.connection === 'offline' ? (
        <DisplayState
          icon={WifiOff}
          title={t('states.offline.title')}
          description={t('states.offline.description')}
          testId="customer-display-offline"
        />
      ) : assignments.length === 0 ? (
        <DisplayState
          icon={MonitorUp}
          title={t('states.noRegister.title')}
          description={t('states.noRegister.description')}
          testId="customer-display-no-register"
        />
      ) : !projection ? (
        <DisplayState
          icon={Radio}
          title={t('states.waiting.title', {
            register: selectedAssignment?.registerName,
          })}
          description={t('states.waiting.description')}
          testId="customer-display-waiting"
        />
      ) : projection.items.length === 0 ? (
        <DisplayState
          icon={ShoppingBag}
          title={t('states.idle.title')}
          description={t('states.idle.description')}
          testId="customer-display-idle"
          live
        />
      ) : (
        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
          <section className="overflow-hidden rounded-3xl border border-white/70 bg-white/90 shadow-soft">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-xl font-semibold text-secondary-950">
                {t('cart.title')}
              </h2>
              <span
                className="inline-flex items-center gap-2 text-sm font-semibold text-success-700"
                role="status"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-success-500" aria-hidden="true" />
                {t('states.live')}
              </span>
            </div>
            <ul className="divide-y divide-line" data-testid="customer-display-items">
              {projection.items.map((item, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-5 px-6 py-5">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-secondary-950">{item.name}</p>
                    <p className="mt-1 text-sm text-secondary-500">
                      {t('cart.quantity', { quantity: item.quantity, unit: item.unitName })}
                      {' · '}
                      {formatCurrency(item.unitPrice, projection.currency, i18n.resolvedLanguage)}
                    </p>
                    {item.discountPercent > 0 ? (
                      <p className="mt-1 text-sm font-medium text-success-700">
                        {t('cart.discount', { discount: item.discountPercent })}
                      </p>
                    ) : null}
                  </div>
                  <strong className="self-center text-xl text-secondary-950">
                    {formatCurrency(item.total, projection.currency, i18n.resolvedLanguage)}
                  </strong>
                </li>
              ))}
            </ul>
          </section>

          <aside
            className="flex h-fit flex-col gap-5 rounded-3xl bg-secondary-950 p-7 text-white shadow-soft"
            aria-label={t('summary.ariaLabel')}
          >
            <div>
              <p className="text-sm text-secondary-300">{t('summary.items')}</p>
              <p className="mt-1 font-display text-3xl font-semibold">
                {projection.summary.itemCount}
              </p>
            </div>
            <dl className="space-y-4 border-t border-white/15 pt-5">
              <SummaryRow
                label={t('summary.subtotal')}
                value={formatCurrency(
                  projection.summary.subtotal,
                  projection.currency,
                  i18n.resolvedLanguage
                )}
              />
              <SummaryRow
                label={t('summary.tax')}
                value={formatCurrency(
                  projection.summary.taxAmount,
                  projection.currency,
                  i18n.resolvedLanguage
                )}
              />
            </dl>
            <div className="border-t border-white/15 pt-5">
              <p className="text-sm text-secondary-300">{t('summary.total')}</p>
              <p
                className="mt-1 break-words font-display text-5xl font-semibold"
                data-testid="customer-display-total"
              >
                {formatCurrency(
                  projection.summary.total,
                  projection.currency,
                  i18n.resolvedLanguage
                )}
              </p>
            </div>
            <p className="text-sm text-secondary-300">{t('summary.checkoutHint')}</p>
          </aside>
        </div>
      )}
      <p className="text-center text-xs text-secondary-500">{t('privacy')}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-secondary-300">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function DisplayState({
  icon: Icon,
  title,
  description,
  testId,
  live = false,
}: {
  icon: typeof MonitorUp;
  title: string;
  description: string;
  testId?: string;
  live?: boolean;
}) {
  return (
    <section
      className="grid flex-1 place-items-center rounded-3xl border border-white/70 bg-white/85 p-8 text-center shadow-soft backdrop-blur"
      data-testid={testId}
      role="status"
      aria-live="polite"
    >
      <div className="max-w-xl">
        <span
          className={`mx-auto grid h-20 w-20 place-items-center rounded-3xl ${live ? 'bg-success-50 text-success-700' : 'bg-primary-50 text-primary-700'}`}
        >
          <Icon className="h-10 w-10" aria-hidden="true" />
        </span>
        <h2 className="mt-6 font-display text-3xl font-semibold text-secondary-950">{title}</h2>
        <p className="mt-3 text-lg text-secondary-600">{description}</p>
      </div>
    </section>
  );
}
