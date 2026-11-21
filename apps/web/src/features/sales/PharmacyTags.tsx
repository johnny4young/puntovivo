import type { ReactNode } from 'react';
import { FileText, Lock, type LucideIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { PharmacyClassification, ProductNextLot } from '@/types';
import { formatLotMonth, type PharmacyLineStatus } from './pharmacyRegister';
import { usePharmacyCopy } from './usePharmacyCopy';

const TONE = {
  neutral: 'bg-surface-3 text-fg2',
  ok: 'bg-success-50 text-success-700',
  info: 'bg-primary-50 text-primary-700',
  warn: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
} as const;
type Tone = keyof typeof TONE;

function Tag({
  tone,
  testId,
  children,
  ...data
}: {
  tone: Tone;
  testId?: string | undefined;
  children: ReactNode;
  [dataAttribute: `data-${string}`]: string;
}) {
  return (
    <span className={`sales-tag gap-1 ${TONE[tone]}`} data-testid={testId} {...data}>
      {children}
    </span>
  );
}

export function PharmacyLotTag({
  lot,
  testId,
  plain = false,
}: {
  lot: ProductNextLot;
  testId?: string;
  /** Plain text inside a meta row; a near expiry always stays a tag. */
  plain?: boolean;
}) {
  const { t, i18n, ready } = usePharmacyCopy();
  if (!ready) return null;
  if (lot.nearExpiry && lot.daysToExpiry !== null) {
    return (
      <Tag tone="warn" testId={testId} data-near-expiry="true">
        {lot.daysToExpiry === 0
          ? t('lot.leaveFirstToday')
          : t('lot.leaveFirst', { count: lot.daysToExpiry })}
      </Tag>
    );
  }
  const text = lot.expiresAt
    ? t('lot.next', { lot: lot.lotNumber, month: formatLotMonth(lot.expiresAt, i18n.language) })
    : t('lot.nextNoExpiry', { lot: lot.lotNumber });
  return plain ? (
    <span data-testid={testId}>{text}</span>
  ) : (
    <Tag tone="neutral" testId={testId}>
      {text}
    </Tag>
  );
}

const CLASS_STYLE: Record<PharmacyClassification, { tone: Tone; Icon?: LucideIcon }> = {
  otc: { tone: 'ok' },
  prescription: { tone: 'info', Icon: FileText },
  controlled: { tone: 'danger', Icon: Lock },
};

export function PharmacyClassTag({
  classification,
  testId,
}: {
  classification: PharmacyClassification;
  testId?: string;
}) {
  const { t, ready } = usePharmacyCopy();
  if (!ready) return null;
  const { tone, Icon } = CLASS_STYLE[classification];
  return (
    <Tag tone={tone} testId={testId}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {t(`classification.${classification}`)}
    </Tag>
  );
}

export function PharmacySavingsTag({ savings, testId }: { savings: number; testId?: string }) {
  const { t, ready } = usePharmacyCopy();
  if (!ready) return null;
  return (
    <Tag tone="info" testId={testId}>
      {t('generic.savings', { amount: formatCurrency(savings) })}
    </Tag>
  );
}

const STATUS_TONE: Record<PharmacyLineStatus['kind'], Tone> = {
  ready: 'ok',
  missing: 'warn',
  blocked: 'danger',
};

/** The prescription state of a ticket line. */
export function PharmacyStatusTag({
  status,
  testId,
}: {
  status: PharmacyLineStatus;
  testId?: string;
}) {
  const { t, ready } = usePharmacyCopy();
  if (!ready) return null;
  return (
    <Tag tone={STATUS_TONE[status.kind]} testId={testId} data-status={status.kind}>
      {status.kind === 'ready'
        ? t('line.ready', { name: status.approverName })
        : t(`line.${status.kind}`)}
    </Tag>
  );
}
