/**
 * Reusable fiscal status chip.
 *
 * Maps each of the 8 fiscal-document statuses (`pending`, `sent`,
 * `accepted`, `rejected`, `contingency`, `voided`,
 * `notified_correction`, `partial_send`) to a colored Badge variant
 * and the existing `fiscal:status.<status>` i18n label. Surfaces are:
 * `SaleDetailsModal`, the admin `FiscalDocumentListPage` row, and (in
 * the future) the Operations Center.
 *
 * extended the union from 5 to 8 values so SAT CFDI
 * cancelaciones, SUNAT envíos parciales, and SII/NFe void lifecycles
 * can be expressed alongside the DIAN-native states. The union here
 * mirrors `fiscalDocumentStatusEnum` in `packages/server/src/db/schema.ts`
 * one-for-one — keep them in lockstep.
 *
 * The badge is the SINGLE source of truth for fiscal status copy on
 * any web surface — never infer "Aceptado" from CUFE presence.
 */
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export type FiscalDocumentStatus =
  | 'pending'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'contingency'
  | 'voided'
  | 'notified_correction'
  | 'partial_send';

const STATUS_TO_VARIANT: Record<FiscalDocumentStatus, BadgeProps['variant']> = {
  accepted: 'success',
  sent: 'primary',
  pending: 'secondary',
  contingency: 'warning',
  rejected: 'danger',
  // `voided` is terminal (the document is unrecoverable),
  // same tone as `rejected`. `notified_correction` is non-terminal but
  // demands operator action, so it shares the warning tone with
  // `contingency`. `partial_send` is in-progress (subset accepted),
  // matching the primary tone of `sent`.
  voided: 'danger',
  notified_correction: 'warning',
  partial_send: 'primary',
};

export interface FiscalStatusBadgeProps {
  status: FiscalDocumentStatus;
  className?: string;
}

export function FiscalStatusBadge({ status, className }: FiscalStatusBadgeProps) {
  const { t } = useTranslation('fiscal');
  return (
    <Badge
      variant={STATUS_TO_VARIANT[status]}
      className={cn('uppercase tracking-wide', className)}
      aria-label={t(`status.${status}`)}
    >
      {t(`status.${status}`)}
    </Badge>
  );
}
