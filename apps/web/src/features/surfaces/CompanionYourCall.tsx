import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SeverityMark } from '@/components/ui';
import { ago, clip, REASON_MAX } from '@/features/dashboard/today/todayModel';
import { approvalWhat, requestedPercent, type QueueItem } from './companionApproval';

interface CompanionYourCallProps {
  /** The owner's queue, oldest first; the first one gets the card. */
  items: readonly QueueItem[];
  generatedAt: string;
  decideHref: (requestId: string) => string;
}

/** The approval waiting on the owner, and a link to the rest of their queue. */
export function CompanionYourCall({ items, generatedAt, decideHref }: CompanionYourCallProps) {
  const { t } = useTranslation(['companion', 'dashboard', 'common']);
  const [mine, ...moreMine] = items;
  if (!mine) return null;
  return (
    <section aria-labelledby="companion-your-call" data-testid="companion-your-call">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="companion-your-call"
          className="flex items-center gap-2 text-[15px] font-semibold text-fg1"
        >
          <SeverityMark severity="blocks" size={14} />
          {t('owner.yourCall')}
        </h2>
        <p className="text-[13px] text-fg3">{ago(mine.requestedAt, generatedAt, t)}</p>
      </div>
      <div className="mt-2 rounded-[18px] border-2 border-danger-500 bg-surface p-4">
        <p className="text-[17px] leading-snug font-semibold text-fg1">
          {t('owner.waiting', { what: approvalWhat(mine, t) })}
        </p>
        <p className="mt-1 text-[13px] text-fg3">{approvalDetail(mine, t)}</p>
        <Link
          to={decideHref(mine.id)}
          className="btn-primary mt-3 flex h-12 w-full items-center justify-center rounded-xl text-base"
          data-testid="companion-decide-open"
        >
          {t('owner.decide')}
        </Link>
      </div>
      {moreMine.length > 0 && (
        <Link
          to={decideHref(moreMine[0]!.id)}
          className="mt-2 flex min-h-11 items-center justify-between gap-3 text-sm text-fg2"
          data-testid="companion-more-approvals"
        >
          {t('owner.moreApprovals', { count: moreMine.length })}
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

/** What is asked: "12 % a Restaurante El Fogón", the share alone, or the clipped reason. */
function approvalWhatDetail(item: QueueItem, t: Translate): string {
  const share = requestedPercent(item);
  const customer = item.decisionContext?.customer?.name;
  if (share && customer) return t('companion:owner.discountTo', { percent: share, customer });
  return share ?? clip(item.reason, REASON_MAX);
}

/** "12 % a Restaurante El Fogón · lo pide Marta Ríos". */
function approvalDetail(item: QueueItem, t: Translate): string {
  return [
    approvalWhatDetail(item, t),
    t('companion:owner.requestedBy', { name: item.requesterName }),
  ].join(' · ');
}
