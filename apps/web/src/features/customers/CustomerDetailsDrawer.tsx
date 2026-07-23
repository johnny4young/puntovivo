/**
 * Customer detail Drawer.
 *
 * Read-only slide-over that holds the customer fields trimmed off the
 * default `CustomersPage` table (email, phone, type, location) plus the
 * identification, so the table can default to the smallest useful column
 * set (name + status). Reuses the shared `Drawer` primitive () for
 * the dialog a11y contract (focus-trap / ESC / labelled-by title) and
 * mirrors `ProductDetailsDrawer`. The optional `onEdit` footer action is
 * passed unconditionally by the caller because the customer edit
 * affordance is ungated (every role can edit a customer).
 *
 * @module features/customers/CustomerDetailsDrawer
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Pencil } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { CustomerLoyaltyPanel } from '@/features/customers/CustomerLoyaltyPanel';
import { resolveCatalogLabel } from '@/features/customers/catalogLabel';
import type { Customer, CustomerCatalogItem } from '@/types';

/**
 * Props for {@link CustomerDetailsDrawer}. The Drawer is open exactly when
 * `customer` is non-null (the parent owns the open/close state).
 */
import { Badge } from '@/components/ui';
export interface CustomerDetailsDrawerProps {
  /** The customer to detail. `null` keeps the Drawer closed. */
  customer: Customer | null;
  /**
   * Identification-type catalog rows, used to resolve the customer's
   * `identificationTypeId` to its human code (never the internal id). Defaults
   * to empty: the resolver then falls back to the raw stored value.
   */
  identificationTypes?: readonly CustomerCatalogItem[] | undefined;
  /**
   * Client-type catalog rows, used to resolve the customer's `clientTypeId` to
   * its human name. Defaults to empty (resolver falls back to the raw value).
   */
  clientTypes?: readonly CustomerCatalogItem[] | undefined;
  /** Close the Drawer (ESC / backdrop / close button). */
  onClose: () => void;
  /**
   * Open the edit form for this customer. Passed unconditionally by the
   * caller (customer edit is ungated); kept optional so the Drawer renders
   * read-only when no editor is wired.
   */
  onEdit?: ((customer: Customer) => void) | undefined;
  /** Export the customer's allowlisted personal-data document. Admin only. */
  onExportData?: ((customer: Customer) => void | Promise<void>) | undefined;
  /** Prevent duplicate export requests while the audited mutation is pending. */
  isExporting?: boolean | undefined;
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

/** Identification type (resolved to its code, never the internal id) + tax id. */
function formatIdentification(
  customer: Customer,
  identificationTypes: readonly CustomerCatalogItem[]
): string {
  const parts = [
    resolveCatalogLabel(identificationTypes, customer.identificationTypeId),
    customer.taxId,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '-';
}
export function CustomerDetailsDrawer({
  customer,
  identificationTypes = [],
  clientTypes = [],
  onClose,
  onEdit,
  onExportData,
  isExporting = false,
}: CustomerDetailsDrawerProps) {
  const { t } = useTranslation('customers');
  const footer = customer ? (
    <div className="flex w-full flex-wrap justify-end gap-2">
      {onExportData && (
        <button
          type="button"
          className="btn-outline mr-auto flex items-center gap-2"
          onClick={() => void onExportData(customer)}
          disabled={isExporting}
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {t(isExporting ? 'privacy.exporting' : 'privacy.export')}
        </button>
      )}
      <button type="button" className="btn-outline" onClick={onClose}>
        {t('details.close')}
      </button>
      {onEdit && (
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={() => onEdit(customer)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
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
            value={formatIdentification(customer, identificationTypes)}
          />
          <DetailField label={t('table.email')} value={customer.email || '-'} />
          <DetailField label={t('table.phone')} value={customer.phone || '-'} />
          <DetailField
            label={t('table.type')}
            value={resolveCatalogLabel(clientTypes, customer.clientTypeId, 'name') || '-'}
          />
          <DetailField label={t('table.location')} value={formatLocation(customer)} />
          <DetailField
            label={t('table.status')}
            value={
              <Badge variant={customer.isActive ? 'success' : 'neutral'}>
                {customer.isActive ? t('table.active') : t('table.inactive')}
              </Badge>
            }
          />
        </dl>
      )}
      {/* points balance + ledger, and the admin correction. Self-
       * gating: silent for tenants without the program (see the panel). */}
      {/* The key also discards an unsaved manual-adjustment draft when an
       * already-open drawer switches to another customer. Carrying the
       * previous customer's points or reason into the next record would be
       * a dangerous default for an admin action. */}
      {customer && <CustomerLoyaltyPanel key={customer.id} customerId={customer.id} />}
    </Drawer>
  );
}
