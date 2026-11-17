import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, SeverityMark, type Severity } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  ApprovalDecisionForm,
  type ApprovalDecision,
} from '@/features/approvals/ManagerApprovalQueue';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { filterPending, type PendingFilter, type TodayPendingItem } from './todayModel';

interface PendingQueueProps {
  numbered: ReadonlyArray<{ item: TodayPendingItem; rank: number }>;
  canAct: boolean;
  approverId: string | null;
  formatCurrency: (value: number) => string;
  formatTime: (iso: string) => string;
}

const SEVERITY_MARK: Record<TodayPendingItem['severity'], Severity> = {
  blocks: 'blocks',
  beforeClose: 'beforeClose',
  whenPossible: 'whenPossible',
};

export function PendingQueue({
  numbered,
  canAct,
  approverId,
  formatCurrency,
  formatTime,
}: PendingQueueProps) {
  const { t } = useTranslation('dashboard');
  const [filter, setFilter] = useState<PendingFilter>('all');
  const items = numbered.map(entry => entry.item);
  const visible = new Set(filterPending(items, filter, canAct));
  const rows = numbered.filter(entry => visible.has(entry.item));
  const counts = {
    all: items.length,
    mine: filterPending(items, 'mine', canAct).length,
    cashiers: filterPending(items, 'cashiers', canAct).length,
  };
  const firstBlocking = rows.find(entry => entry.item.severity === 'blocks')?.item.id;

  return (
    <section aria-labelledby="today-pending-title" data-testid="today-pending">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="today-pending-title" className="text-[2rem] leading-none">
          {t('today.pending.title')}{' '}
          <span className="font-numeric text-fg3" data-testid="today-pending-count">
            {items.length}
          </span>
        </h2>
        <div
          className="ml-auto flex gap-1"
          role="group"
          aria-label={t('today.pending.filterLabel')}
        >
          {(['all', 'mine', 'cashiers'] as const).map(key => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              data-testid={`today-pending-filter-${key}`}
              onClick={() => setFilter(key)}
              className={cn(
                'min-h-9 rounded-full px-3 text-sm font-semibold',
                filter === key ? 'bg-fg1 text-[var(--background)]' : 'bg-surface-3 text-fg2'
              )}
            >
              {t(`today.pending.filters.${key}`, { count: counts[key] })}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-fg2" data-testid="today-pending-empty">
          <SeverityMark severity="ready" size={18} />
          {t('today.pending.empty')}
        </p>
      ) : (
        (['blocks', 'beforeClose', 'whenPossible'] as const).map(severity => {
          const group = rows.filter(entry => entry.item.severity === severity);
          if (group.length === 0) return null;
          return (
            <div key={severity} className="mt-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-fg1">
                <SeverityMark severity={SEVERITY_MARK[severity]} size={16} />
                {t(`today.pending.severity.${severity}`)}
              </p>
              <ol className="mt-2">
                {group.map(({ item, rank }) => (
                  <PendingRow
                    key={item.id}
                    item={item}
                    rank={rank}
                    emphasized={item.id === firstBlocking}
                    canAct={canAct}
                    approverId={approverId}
                    formatCurrency={formatCurrency}
                    formatTime={formatTime}
                  />
                ))}
              </ol>
            </div>
          );
        })
      )}
    </section>
  );
}

function PendingRow({
  item,
  rank,
  emphasized,
  canAct,
  approverId,
  formatCurrency,
  formatTime,
}: {
  item: TodayPendingItem;
  rank: number;
  emphasized: boolean;
  canAct: boolean;
  approverId: string | null;
  formatCurrency: (value: number) => string;
  formatTime: (iso: string) => string;
}) {
  const { t } = useTranslation(['dashboard', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const resolveMutation = trpc.registerIncidents.resolve.useMutation({
    onSuccess: () => utils.operations.today.invalidate(),
    onError: onErrorToast(toast, t, { titleKey: 'dashboard:today.pending.resolveError' }),
  });

  const { title, detail } = describe(item, t, formatCurrency, formatTime);
  const action = canAct ? rowAction(item, t) : null;

  return (
    <li
      data-testid={`today-pending-row-${item.kind}`}
      className={cn(
        'flex flex-wrap items-center gap-4 border-b border-line py-3',
        emphasized && 'rounded-[14px] border-2 border-danger-500 bg-surface px-4'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'font-numeric w-6 text-[1.6rem] leading-none',
          item.severity === 'blocks' ? 'text-danger-700' : 'text-fg1'
        )}
      >
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-fg1">{title}</p>
        <p className="text-sm text-fg3">{detail}</p>
      </div>
      {action?.kind === 'approval' && !decision && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="compact"
            onClick={() => setDecision('rejected')}
            data-testid="today-approval-reject"
          >
            {t('dashboard:today.pending.actions.reject')}
          </Button>
          <Button
            size="compact"
            onClick={() => setDecision('approved')}
            data-testid="today-approval-approve"
          >
            {t('dashboard:today.pending.actions.approve')}
          </Button>
        </div>
      )}
      {action?.kind === 'link' && (
        <Link
          to={action.to}
          className="btn-outline min-h-9 px-3 text-sm"
          data-testid={`today-pending-link-${item.kind}`}
        >
          {action.label}
        </Link>
      )}
      {canAct && item.kind === 'incident' && (
        <Button
          variant="outline"
          size="compact"
          disabled={resolveMutation.isPending}
          onClick={() => resolveMutation.mutate({ id: item.id })}
          data-testid="today-incident-resolve"
        >
          {t('dashboard:today.pending.actions.resolve')}
        </Button>
      )}
      {item.kind === 'approval' && decision && (
        <div className="w-full">
          {approverId ? (
            <ApprovalDecisionForm
              requestId={item.id}
              decision={decision}
              approverId={approverId}
              onCancel={() => setDecision(null)}
              onDecided={() => {
                setDecision(null);
                void utils.operations.today.invalidate();
              }}
            />
          ) : (
            <p className="text-sm text-fg3">{t('common:userMenu.approvals.pinMissing')}</p>
          )}
        </div>
      )}
    </li>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function describe(
  item: TodayPendingItem,
  t: Translate,
  formatCurrency: (value: number) => string,
  formatTime: (iso: string) => string
): { title: string; detail: string } {
  switch (item.kind) {
    case 'approval':
      return {
        title: t('dashboard:today.pending.approval', {
          label: item.label,
          amount: item.amount === null ? '' : formatCurrency(item.amount),
        }),
        detail: t('dashboard:today.pending.approvalDetail', {
          requester: item.requesterName,
          site: item.siteName,
          time: formatTime(item.at),
        }),
      };
    case 'staleSession':
      return {
        title: t('dashboard:today.pending.staleSession', {
          register: item.registerName,
          time: formatTime(item.at),
        }),
        detail: t('dashboard:today.pending.staleSessionDetail', { cashier: item.cashierName }),
      };
    case 'incident': {
      const elsewhere = item.incident.stockBySite.find(
        site => site.siteId !== item.incident.siteId && site.onHand > 0
      );
      return {
        title: t(`dashboard:today.pending.incident.${item.incident.kind}`, {
          product: item.incident.productName ?? item.incident.note ?? '',
        }),
        detail: t('dashboard:today.pending.incidentDetail', {
          reporter: item.incident.reportedByName,
          site: item.incident.siteName,
          elsewhere: elsewhere
            ? t('dashboard:today.pending.elsewhere', {
                site: elsewhere.siteName,
                count: elsewhere.onHand,
              })
            : '',
        }),
      };
    }
    case 'attention':
      return {
        title: t(`dashboard:today.pending.attention.${item.area}`, { count: item.count }),
        detail: t('dashboard:today.pending.attentionDetail'),
      };
  }
}

function rowAction(
  item: TodayPendingItem,
  t: Translate
): { kind: 'approval' } | { kind: 'link'; to: string; label: string } | null {
  switch (item.kind) {
    case 'approval':
      return { kind: 'approval' };
    case 'staleSession':
      return {
        kind: 'link',
        to: '/operations?tab=cash',
        label: t('dashboard:today.pending.actions.countAndClose'),
      };
    case 'incident': {
      const elsewhere = item.incident.stockBySite.find(
        site => site.siteId !== item.incident.siteId && site.onHand > 0
      );
      return item.incident.kind === 'stockout' && elsewhere
        ? {
            kind: 'link',
            to: '/inventory?view=balances',
            label: t('dashboard:today.pending.actions.transfer', { count: elsewhere.onHand }),
          }
        : null;
    }
    case 'attention':
      return {
        kind: 'link',
        to: `/operations?tab=${item.area}`,
        label:
          item.area === 'fiscal'
            ? t('dashboard:today.pending.actions.fix')
            : t('dashboard:today.pending.actions.review'),
      };
  }
}
