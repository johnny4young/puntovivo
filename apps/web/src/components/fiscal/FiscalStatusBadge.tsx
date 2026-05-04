/**
 * ENG-058 — Reusable fiscal status chip.
 *
 * Maps each of the 5 fiscal-document statuses (`pending`, `sent`,
 * `accepted`, `rejected`, `contingency`) to a colored Badge variant
 * and the existing `fiscal:status.<status>` i18n label. Surfaces
 * are: `SaleDetailsModal`, the admin `FiscalDocumentListPage` row,
 * and (in the future) the Operations Center.
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
  | 'contingency';

const STATUS_TO_VARIANT: Record<FiscalDocumentStatus, BadgeProps['variant']> = {
  accepted: 'success',
  sent: 'primary',
  pending: 'secondary',
  contingency: 'warning',
  rejected: 'danger',
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
