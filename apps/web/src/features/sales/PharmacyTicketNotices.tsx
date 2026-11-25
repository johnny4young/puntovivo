import { FileText, Lock, UserPlus } from 'lucide-react';
import { initialsOf } from './handoff/handoffModel';
import { formatDayMonth, type PharmacyCustomerNote } from './pharmacyRegister';
import { usePharmacyCopy } from './usePharmacyCopy';

interface PharmacyTicketNoticesProps {
  customerNote: PharmacyCustomerNote | null;
  hasControlled: boolean;
  /** Shown where nothing above already names the customer (phone). */
  customerName?: string | null | undefined;
  /** Omitted when the ticket's customer is frozen. */
  onAssignCustomer?: (() => void) | undefined;
}

/** Why the ticket needs a named customer, and the controlled-medicine block. */
export function PharmacyTicketNotices({
  customerNote,
  hasControlled,
  customerName,
  onAssignCustomer,
}: PharmacyTicketNoticesProps) {
  const { t, i18n, ready } = usePharmacyCopy();
  if (!ready) return null;

  let validity: string | null = null;
  if (customerNote && !customerNote.missing && customerNote.validUntil) {
    const date = formatDayMonth(customerNote.validUntil, i18n.language);
    validity = customerNote.quantity
      ? t('customer.validUntilQuantity', { date, ...customerNote.quantity })
      : t('customer.validUntil', { date });
  }

  return (
    <div className="flex flex-col gap-2">
      {customerNote?.missing && (
        <section className="sales-account sales-rx-missing" data-testid="pharmacy-customer-missing">
          <div className="sales-account-row">
            <UserPlus className="h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm font-semibold">{t('customer.missing')}</p>
            {onAssignCustomer && (
              <button
                type="button"
                className="btn-outline sales-account-pay"
                onClick={onAssignCustomer}
                data-testid="pharmacy-customer-assign"
              >
                {t('customer.assign')}
              </button>
            )}
          </div>
        </section>
      )}
      {customerNote && !customerNote.missing && (
        <section className="sales-account" data-testid="pharmacy-customer-required">
          <div className="sales-account-name">
            {customerName ? (
              <span className="sales-avatar sales-avatar-sm" aria-hidden="true">
                {initialsOf(customerName)}
              </span>
            ) : (
              <span className="sales-rx-icon" aria-hidden="true">
                <FileText className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              {customerName && <p className="truncate font-semibold text-fg1">{customerName}</p>}
              <p className="text-[13px] text-fg2">
                {t('customer.required')}
                {validity && <> · {validity}</>}
              </p>
            </div>
          </div>
        </section>
      )}
      {hasControlled && (
        <p className="sales-rx-notice" role="status" data-testid="pharmacy-controlled-notice">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('controlled')}</span>
        </p>
      )}
    </div>
  );
}
