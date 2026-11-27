import { AlertTriangle, FileText, Lock, ShieldAlert, UserPlus } from 'lucide-react';
import { initialsOf } from './handoff/handoffModel';
import { formatDayMonth, type PharmacyCustomerNote } from './pharmacyRegister';
import { usePharmacyCopy } from './usePharmacyCopy';
import type { PharmacySafetyAlert } from './usePharmacyTicket';

interface PharmacyTicketNoticesProps {
  customerNote: PharmacyCustomerNote | null;
  hasControlled: boolean;
  safetyAlerts?: readonly PharmacySafetyAlert[] | undefined;
  /** Shown where nothing above already names the customer (phone). */
  customerName?: string | null | undefined;
  /** Omitted when the ticket's customer is frozen. */
  onAssignCustomer?: (() => void) | undefined;
}

/** Why the ticket needs a named customer, controlled-medicine block, and allergy/duplicity alerts. */
export function PharmacyTicketNotices({
  customerNote,
  hasControlled,
  safetyAlerts = [],
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
      {safetyAlerts.map((alert, idx) =>
        alert.kind === 'customer_allergy' ? (
          <p
            key={`allergy-${alert.productId}-${idx}`}
            className="flex items-start gap-2 rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-xs font-semibold text-danger-900"
            role="alert"
            data-testid="pharmacy-allergy-alert"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-700" aria-hidden="true" />
            <span>
              {t('safety.customerAllergy', {
                severity: t(`safety.severity.${alert.severity}`),
                ingredient: alert.activeIngredient,
                product: alert.productName,
              })}
              {alert.notes ? ` · ${alert.notes}` : ''}
            </span>
          </p>
        ) : (
          <p
            key={`dup-${alert.activeIngredient}-${idx}`}
            className="flex items-start gap-2 rounded-xl border border-warning-300 bg-warning-50 px-3 py-2 text-xs font-medium text-warning-950"
            role="status"
            data-testid="pharmacy-duplicity-alert"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-warning-700"
              aria-hidden="true"
            />
            <span>
              {t('safety.duplicateIngredient', {
                ingredient: alert.activeIngredient,
                products: alert.productNames.join(', '),
              })}
            </span>
          </p>
        )
      )}
    </div>
  );
}
