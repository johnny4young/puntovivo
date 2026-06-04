/**
 * ENG-132b — Customer detail Drawer.
 *
 * Read-only slide-over that holds the customer fields trimmed off the
 * default `CustomersPage` table (email, phone, type, location) plus the
 * identification, so the table can default to the smallest useful column
 * set (name + status). Reuses the shared `Drawer` primitive (ENG-186) for
 * the dialog a11y contract (focus-trap / ESC / labelled-by title) and
 * mirrors `ProductDetailsDrawer`. The optional `onEdit` footer action is
 * passed unconditionally by the caller because the customer edit
 * affordance is ungated (every role can edit a customer).
 *
 * @module features/customers/CustomerDetailsDrawer
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { cn } from '@/lib/utils';
import type { Customer } from '@/types';

/**
 * Props for {@link CustomerDetailsDrawer}. The Drawer is open exactly when
 * `customer` is non-null (the parent owns the open/close state).
 */
export interface CustomerDetailsDrawerProps {
  /** The customer to detail. `null` keeps the Drawer closed. */
  customer: Customer | null;
  /** Close the Drawer (ESC / backdrop / close button). */
  onClose: () => void;
  /**
   * Open the edit form for this customer. Passed unconditionally by the
   * caller (customer edit is ungated); kept optional so the Drawer renders
   * read-only when no editor is wired.
   */
  onEdit?: ((customer: Customer) => void) | undefined;
}

/** One label/value row in the read-only detail list. */
function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2 last:border-0">
      <dt className="text-sm text-secondary-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-secondary-900">{value}</dd>
    </div>
  );
}

/** City, state → "City, State"; falls back to country, then "-". */
function formatLocation(customer: Customer): string {
  const location = [customer.city, customer.state].filter(Boolean).join(', ');
  return location || customer.country || '-';
}

/** Identification type + tax id (mirrors the table's name sub-label). */
function formatIdentification(customer: Customer): string {
  const parts = [customer.identificationTypeId, customer.taxId].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '-';
}

export function CustomerDetailsDrawer({
  customer,
  onClose,
  onEdit,
}: CustomerDetailsDrawerProps) {
  const { t } = useTranslation('customers');

  const footer = customer ? (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-outline" onClick={onClose}>
        {t('details.close')}
      </button>
      {onEdit && (
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={() => onEdit(customer)}
        >
          <Pencil className="h-4 w-4" />
          {t('details.edit')}
        </button>
      )}
    </div>
  ) : undefined;

  return (
    <Drawer
      isOpen={!!customer}
      onClose={onClose}
      title={customer?.name ?? t('details.title')}
      size="md"
      testId="customer-details-drawer"
      footer={footer}
    >
      {customer && (
        <dl data-testid="customer-details-fields">
          <DetailField
            label={t('details.identification')}
            value={formatIdentification(customer)}
          />
          <DetailField label={t('table.email')} value={customer.email || '-'} />
          <DetailField label={t('table.phone')} value={customer.phone || '-'} />
          <DetailField label={t('table.type')} value={customer.clientTypeId || '-'} />
          <DetailField label={t('table.location')} value={formatLocation(customer)} />
          <DetailField
            label={t('table.status')}
            value={
              <span className={cn('pv-badge', customer.isActive ? 'success' : 'neutral')}>
                {customer.isActive ? t('table.active') : t('table.inactive')}
              </span>
            }
          />
        </dl>
      )}
    </Drawer>
  );
}
