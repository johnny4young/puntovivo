import { useState } from 'react';
import { BookOpenCheck, Printer, ShieldAlert, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { roundQuantity } from '@puntovivo/shared/unit-math';

import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { useTenant } from '@/features/tenant/TenantProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { AUTO_PRINT_SCRIPT, escapeHtml, printHtmlDocument } from '@/lib/receiptDocumentPrint';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';

interface PharmacyFnePanelProps {
  isAdmin: boolean;
  countryCode: string;
  businessDate: string;
  fneEnabled: boolean;
  fneResolutionNumber: string | null;
}

export function PharmacyFnePanel({
  isAdmin,
  countryCode,
  businessDate,
  fneEnabled,
  fneResolutionNumber,
}: PharmacyFnePanelProps) {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();

  const [resolutionNumber, setResolutionNumber] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('Fondo Nacional de Estupefacientes');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [validFrom, setValidFrom] = useState(businessDate);
  const [validUntil, setValidUntil] = useState('');
  const [month, setMonth] = useState(businessDate.slice(0, 7));

  const [customerId, setCustomerId] = useState('');
  const [allergyIngredient, setAllergyIngredient] = useState('');
  const [allergySeverity, setAllergySeverity] = useState<'mild' | 'moderate' | 'severe'>(
    'moderate'
  );
  const [allergyNotes, setAllergyNotes] = useState('');

  const usersQuery = trpc.users.list.useQuery(
    { page: 1, perPage: 100, isActive: true },
    { enabled: isAdmin }
  );
  const customersQuery = trpc.customers.list.useQuery({ page: 1, perPage: 50 });
  const fneAuthsQuery = trpc.pharmacy.listFneAuthorizations.useQuery({
    siteId: currentSite?.id ?? undefined,
    activeOnly: false,
    page: 1,
    perPage: 20,
  });
  const validMonth = /^\d{4}-\d{2}$/.test(month);
  const monthlyReportQuery = trpc.pharmacy.getFneMonthlyReport.useQuery(
    { siteId: currentSite?.id ?? undefined, month },
    { enabled: !!currentSite?.id && validMonth }
  );
  const allergiesQuery = trpc.pharmacy.listCustomerAllergies.useQuery(
    { customerId },
    { enabled: Boolean(customerId) }
  );

  const createFne = useCriticalMutation('pharmacy.createFneAuthorization', {
    onSuccess: async () => {
      await Promise.all([
        utils.pharmacy.listFneAuthorizations.invalidate(),
        utils.pharmacy.context.invalidate(),
        utils.pharmacy.getFneMonthlyReport.invalidate(),
      ]);
      setResolutionNumber('');
      setValidUntil('');
      toast.success({ title: t('pharmacy:fne.toast.authCreated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:fne.toast.error' }),
  });

  const revokeFne = useCriticalMutation('pharmacy.revokeFneAuthorization', {
    onSuccess: async () => {
      await Promise.all([
        utils.pharmacy.listFneAuthorizations.invalidate(),
        utils.pharmacy.context.invalidate(),
        utils.pharmacy.getFneMonthlyReport.invalidate(),
      ]);
      toast.success({ title: t('pharmacy:fne.toast.authRevoked') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:fne.toast.error' }),
  });

  const addAllergy = trpc.pharmacy.addCustomerAllergy.useMutation({
    onSuccess: async () => {
      await utils.pharmacy.listCustomerAllergies.invalidate();
      setAllergyIngredient('');
      setAllergyNotes('');
      toast.success({ title: t('pharmacy:fne.toast.allergyAdded') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:fne.toast.error' }),
  });

  const removeAllergy = trpc.pharmacy.removeCustomerAllergy.useMutation({
    onSuccess: async () => {
      await utils.pharmacy.listCustomerAllergies.invalidate();
      toast.success({ title: t('pharmacy:fne.toast.allergyRemoved') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:fne.toast.error' }),
  });

  async function handlePrintFneReport() {
    const report = monthlyReportQuery.data;
    if (!report) return;
    const rowsHtml = report.summary
      .map(s => {
        const netReturns = roundQuantity(s.returns - (s.supplierReturns ?? 0), 12);
        return `<tr>
          <td>${escapeHtml(s.name)} (${escapeHtml(s.sku)})</td>
          <td>${escapeHtml(s.sanitaryRegistration ?? '—')}</td>
          <td>${s.openingBalance}</td>
          <td>${s.receipts}</td>
          <td>${s.dispensations}</td>
          <td>${netReturns}</td>
          <td>${s.fractionationsNet}</td>
          <td>${s.destructions}</td>
          <td>${s.closingBalance}</td>
        </tr>`;
      })
      .join('');
    try {
      await printHtmlDocument({
        buildHtml: ({ autoPrint }) =>
          `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t('pharmacy:fne.reportTitle'))} ${escapeHtml(report.month)}</title>
          <style>body{font-family:system-ui,sans-serif;padding:20px;color:#111}h1{font-size:18px;margin:0 0 6px}p{margin:2px 0;font-size:12px}
          table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#f1f5f9}</style>
          </head><body>
          <h1>${escapeHtml(t('pharmacy:fne.reportTitle'))} (Res. 1478/2006)</h1>
          <p>${escapeHtml(report.siteName)} · ${escapeHtml(report.month)}${report.activeAuthorization ? ` · ${escapeHtml(report.activeAuthorization.resolutionNumber)}` : ''}</p>
          <table><thead><tr><th>${escapeHtml(t('pharmacy:fne.columns.medicine'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.registration'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.opening'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.receipts'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.dispensations'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.returns'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.fractionations'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.destructions'))}</th><th>${escapeHtml(t('pharmacy:fne.columns.closing'))}</th></tr></thead><tbody>${rowsHtml}</tbody></table>
          ${autoPrint ? AUTO_PRINT_SCRIPT : ''}</body></html>`,
        createError: (_code, message) => new Error(message),
        desktopBridgeFailedMessage: t('pharmacy:fne.toast.error'),
        unknownErrorMessage: t('pharmacy:fne.toast.error'),
        cancelledDialogIsSuccess: true,
        windowFeatures: 'noopener,noreferrer,width=960,height=720',
      });
    } catch (err) {
      toast.error({
        title: t('pharmacy:fne.toast.error'),
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div className="space-y-5" data-testid="pharmacy-fne-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-secondary-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <BookOpenCheck className="h-5 w-5 text-primary-700" aria-hidden="true" />
          <Badge variant={fneEnabled ? 'success' : 'warning'} data-testid="pharmacy-fne-status">
            {fneEnabled
              ? t('pharmacy:fne.statusEnabled', { resolution: fneResolutionNumber ?? '' })
              : t('pharmacy:fne.statusDisabled')}
          </Badge>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="card space-y-4 p-5">
          <h3 className="font-semibold text-secondary-950">{t('pharmacy:fne.authTitle')}</h3>
          {isAdmin && (
            <div className="space-y-3">
              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-fne-resolution">
                  {t('pharmacy:fne.resolutionNumber')}
                </label>
                <input
                  id="pharmacy-fne-resolution"
                  data-testid="pharmacy-fne-resolution"
                  className="pv-input"
                  value={resolutionNumber}
                  onChange={e => setResolutionNumber(e.target.value)}
                />
              </div>
              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-fne-authority">
                  {t('pharmacy:fne.issuingAuthority')}
                </label>
                <input
                  id="pharmacy-fne-authority"
                  className="pv-input"
                  value={issuingAuthority}
                  onChange={e => setIssuingAuthority(e.target.value)}
                />
              </div>
              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-fne-responsible">
                  {t('pharmacy:fne.responsible')}
                </label>
                <select
                  id="pharmacy-fne-responsible"
                  data-testid="pharmacy-fne-responsible"
                  className="pv-input"
                  value={responsibleUserId}
                  onChange={e => setResponsibleUserId(e.target.value)}
                >
                  <option value="">{t('pharmacy:authorizations.employeePlaceholder')}</option>
                  {(usersQuery.data?.items ?? [])
                    .filter(u => u.isActive !== false)
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.email}
                      </option>
                    ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="pv-field">
                  <label className="label" htmlFor="pharmacy-fne-from">
                    {t('pharmacy:authorizations.validFrom')}
                  </label>
                  <input
                    id="pharmacy-fne-from"
                    type="date"
                    className="pv-input"
                    value={validFrom}
                    onChange={e => setValidFrom(e.target.value)}
                  />
                </div>
                <div className="pv-field">
                  <label className="label" htmlFor="pharmacy-fne-until">
                    {t('pharmacy:authorizations.validUntil')}
                  </label>
                  <input
                    id="pharmacy-fne-until"
                    type="date"
                    className="pv-input"
                    value={validUntil}
                    onChange={e => setValidUntil(e.target.value)}
                  />
                </div>
              </div>
              <Button
                type="button"
                data-testid="pharmacy-fne-register"
                disabled={
                  resolutionNumber.trim().length < 3 ||
                  issuingAuthority.trim().length < 3 ||
                  !responsibleUserId ||
                  !validFrom ||
                  Boolean(validUntil && validUntil < validFrom) ||
                  createFne.isPending
                }
                onClick={() =>
                  createFne.mutate({
                    siteId: currentSite?.id ?? null,
                    countryCode,
                    resolutionNumber: resolutionNumber.trim(),
                    issuingAuthority: issuingAuthority.trim(),
                    responsibleUserId,
                    validFrom,
                    validUntil: validUntil || null,
                  })
                }
              >
                {t('pharmacy:fne.registerAuth')}
              </Button>
            </div>
          )}

          <div className="space-y-2 pt-2">
            {fneAuthsQuery.data?.items.map(auth => (
              <div
                key={auth.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-secondary-200 p-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-secondary-950">{auth.resolutionNumber}</p>
                  <p className="text-xs text-secondary-600">
                    {auth.responsibleUserName} · {auth.validFrom}
                    {auth.validUntil ? ` → ${auth.validUntil}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={auth.status === 'active' ? 'success' : 'neutral'}>
                    {t(`pharmacy:common.authorizationStatus.${auth.status}`)}
                  </Badge>
                  {isAdmin && auth.status === 'active' && (
                    <Button
                      type="button"
                      size="compact"
                      variant="outline"
                      onClick={() =>
                        revokeFne.mutate({
                          id: auth.id,
                          reason: t('pharmacy:fne.defaultRevokeReason'),
                        })
                      }
                    >
                      {t('pharmacy:fne.revokeAuth')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 text-danger-600" aria-hidden="true" />
            <h3 className="font-semibold text-secondary-950">{t('pharmacy:fne.allergiesTitle')}</h3>
          </div>

          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-allergy-customer">
              {t('pharmacy:fne.selectCustomer')}
            </label>
            <select
              id="pharmacy-allergy-customer"
              data-testid="pharmacy-allergy-customer"
              className="pv-input"
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
            >
              <option value="">{t('pharmacy:fne.selectCustomerPlaceholder')}</option>
              {(customersQuery.data?.items ?? []).map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.taxId ? ` · ${c.taxId}` : ''}
                </option>
              ))}
            </select>
          </div>

          {customerId && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="pv-field">
                  <label className="label" htmlFor="pharmacy-allergy-ingredient">
                    {t('pharmacy:fne.allergyIngredient')}
                  </label>
                  <input
                    id="pharmacy-allergy-ingredient"
                    data-testid="pharmacy-allergy-ingredient"
                    className="pv-input"
                    value={allergyIngredient}
                    onChange={e => setAllergyIngredient(e.target.value)}
                  />
                </div>
                <div className="pv-field">
                  <label className="label" htmlFor="pharmacy-allergy-severity">
                    {t('pharmacy:fne.allergySeverity')}
                  </label>
                  <select
                    id="pharmacy-allergy-severity"
                    className="pv-input"
                    value={allergySeverity}
                    onChange={e =>
                      setAllergySeverity(e.target.value as 'mild' | 'moderate' | 'severe')
                    }
                  >
                    <option value="mild">{t('pharmacy:fne.severities.mild')}</option>
                    <option value="moderate">{t('pharmacy:fne.severities.moderate')}</option>
                    <option value="severe">{t('pharmacy:fne.severities.severe')}</option>
                  </select>
                </div>
              </div>
              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-allergy-notes">
                  {t('pharmacy:fne.allergyNotes')}
                </label>
                <input
                  id="pharmacy-allergy-notes"
                  className="pv-input"
                  value={allergyNotes}
                  onChange={e => setAllergyNotes(e.target.value)}
                />
              </div>
              <Button
                type="button"
                data-testid="pharmacy-allergy-add"
                disabled={allergyIngredient.trim().length < 2 || addAllergy.isPending}
                onClick={() =>
                  addAllergy.mutate({
                    customerId,
                    activeIngredient: allergyIngredient.trim(),
                    severity: allergySeverity,
                    notes: allergyNotes.trim() || null,
                  })
                }
              >
                {t('pharmacy:fne.addAllergy')}
              </Button>

              <ul className="space-y-2 pt-2">
                {(allergiesQuery.data?.items.length ?? 0) === 0 ? (
                  <li className="text-xs text-secondary-500">{t('pharmacy:fne.emptyAllergies')}</li>
                ) : (
                  allergiesQuery.data?.items.map(item => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-secondary-200 px-3 py-2 text-sm"
                    >
                      <span>
                        <strong className="text-secondary-950">{item.activeIngredient}</strong>
                        <span className="ml-2 text-xs text-secondary-600">
                          ({t(`pharmacy:fne.severities.${item.severity}`)})
                        </span>
                      </span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-danger-700 hover:underline"
                        onClick={() => removeAllergy.mutate({ id: item.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('pharmacy:fne.removeAllergy')}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <h3 className="font-semibold text-secondary-950">{t('pharmacy:fne.reportTitle')}</h3>
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-fne-month">
                {t('pharmacy:fne.month')}
              </label>
              <input
                id="pharmacy-fne-month"
                type="month"
                className="pv-input"
                value={month}
                onChange={e => setMonth(e.target.value)}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!monthlyReportQuery.data}
            onClick={() => void handlePrintFneReport()}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:fne.printReport')}
          </Button>
        </div>

        {(monthlyReportQuery.data?.summary.length ?? 0) === 0 ? (
          <p className="text-sm text-secondary-500">{t('pharmacy:fne.emptyReport')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-secondary-200 text-xs uppercase text-secondary-500">
                <tr>
                  <th className="py-2 pr-3">{t('pharmacy:fne.columns.medicine')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fne.columns.opening')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fne.columns.receipts')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fne.columns.dispensations')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fne.columns.returns')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fne.columns.fractionations')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:fne.columns.destructions')}</th>
                  <th className="py-2">{t('pharmacy:fne.columns.closing')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {monthlyReportQuery.data?.summary.map(row => (
                  <tr key={row.productId}>
                    <td className="py-2.5 pr-3 font-medium text-secondary-950">
                      {row.name}
                      <span className="ml-2 font-mono text-xs text-secondary-500">
                        {row.sanitaryRegistration ?? row.sku}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono">{row.openingBalance}</td>
                    <td className="py-2.5 pr-3 font-mono">{row.receipts}</td>
                    <td className="py-2.5 pr-3 font-mono">{row.dispensations}</td>
                    <td className="py-2.5 pr-3 font-mono">
                      {roundQuantity(row.returns - (row.supplierReturns ?? 0), 12)}
                    </td>
                    <td className="py-2.5 pr-3 font-mono">{row.fractionationsNet}</td>
                    <td className="py-2.5 pr-3 font-mono">{row.destructions}</td>
                    <td className="py-2.5 font-mono font-semibold">{row.closingBalance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
