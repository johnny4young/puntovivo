import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import { BookOpenCheck, Download, FileSpreadsheet, RotateCcw, Save, Table2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import { Button, KpiTile } from '@/components/ui';
import { EmptyState } from '@/components/feedback/EmptyState';
import { exportToCSV, type ExportColumn } from '@/services/export/exportService';
import {
  buildGenericVoucherRows,
  buildJournalEntries,
  buildSiigoInvoiceRows,
  chunkSiigoRows,
  findSiigoConsecutiveCollisions,
  SIIGO_INVOICE_COLUMNS,
  type AccountingPucAccounts,
  type GenericVoucherRow,
  type JournalEntryRow,
  type SiigoRow,
} from './accountingExportFormats';
import { isValidAccountingDateRange } from './accountingDateRange';
import { exportSiigoChunks } from './accountingSiigoExport';

const PAYMENT_ACCOUNT_KEYS = ['cash', 'card', 'transfer', 'credit', 'other'] as const;
const LEDGER_ACCOUNT_KEYS = [
  'income',
  'iva',
  'inc',
  'tips',
  'receivable',
  'storeCredit',
  'refunds',
] as const;
const PUC_CODE_PATTERN = /^[1-9]\d{3,11}$/;

function cloneAccounts(accounts: AccountingPucAccounts): AccountingPucAccounts {
  return { ...accounts, paymentMethods: { ...accounts.paymentMethods } };
}

function accountsAreValid(
  accounts: AccountingPucAccounts | null
): accounts is AccountingPucAccounts {
  if (!accounts) return false;
  return [
    ...Object.values(accounts.paymentMethods),
    ...LEDGER_ACCOUNT_KEYS.map(key => accounts[key]),
  ].every(account => PUC_CODE_PATTERN.test(account));
}

/** Local calendar day as `YYYY-MM-DD` (what `<input type="date">` expects). */
function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function firstOfLastMonth(): string {
  const now = new Date();
  return isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

function lastOfLastMonth(): string {
  const now = new Date();
  return isoDay(new Date(now.getFullYear(), now.getMonth(), 0));
}

const SIIGO_COLUMNS: ExportColumn<SiigoRow>[] = SIIGO_INVOICE_COLUMNS.map((header, index) => ({
  key: `cells.${index}`,
  header,
  formatter: (_value: unknown, row: SiigoRow) => row.cells[index] ?? '',
}));

/**
 * admin accountant hand-off page.
 *
 * Exports completed sales of a date range as the files an accountant
 * imports into the Colombian bookkeeping suites: the Siigo Nube sales
 * invoice template (documented columns, 500-row file limit
 * honored), balanced journal entries for column-mapping importers
 * (Alegra), and a flat generic layout (World Office and others).
 * Company-specific vendor codes are deliberately left blank — this
 * page never guesses another system's configuration.
 */
export function AccountingExportPage() {
  const { t } = useTranslation('reports');

  const [fromDate, setFromDate] = useState<string>(firstOfLastMonth);
  const [toDate, setToDate] = useState<string>(lastOfLastMonth);
  // null means there is no user override yet. An empty string is the
  // deliberate all-sites choice and therefore cannot use a truthy fallback.
  const [siteSelectionOverride, setSiteSelectionOverride] = useState<string | null>(null);
  const [siigoFileCount, setSiigoFileCount] = useState<number | null>(null);
  const [siigoExportError, setSiigoExportError] = useState(false);
  const [siigoExporting, setSiigoExporting] = useState(false);
  const [accountsDraftOverride, setAccountsDraftOverride] = useState<AccountingPucAccounts | null>(
    null
  );
  const [accountsSaved, setAccountsSaved] = useState(false);

  const sitesQuery = trpc.sites.list.useQuery();
  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data]);
  const settingsQuery = trpc.reports.accounting.settings.useQuery();
  const updateAccountsMutation = trpc.reports.accounting.updateAccounts.useMutation({
    onSuccess: data => {
      setAccountsDraftOverride(cloneAccounts(data.accounts));
      setAccountsSaved(true);
    },
  });
  const rememberSiteMutation = trpc.reports.accounting.rememberSite.useMutation();

  const accountsDraft = accountsDraftOverride ?? settingsQuery.data?.accounts ?? null;
  const preferredSiteId = useMemo((): string | null => {
    if (sitesQuery.data === undefined || settingsQuery.isLoading) return null;
    const stored = settingsQuery.data?.lastSiteId ?? null;
    return stored && sites.some(site => site.id === stored) ? stored : '';
  }, [settingsQuery.data, settingsQuery.isLoading, sites, sitesQuery.data]);
  const selectedSiteId = siteSelectionOverride ?? preferredSiteId ?? '';

  // Tenant-LOCAL calendar days: the server resolves them to a UTC
  // window with the tenant timezone, so the period matches the
  // day-close evidence instead of drifting five hours in Colombia.
  const input = useMemo(
    () => ({
      from: fromDate,
      to: toDate,
      ...(selectedSiteId ? { siteId: selectedSiteId } : {}),
    }),
    [fromDate, toDate, selectedSiteId]
  );
  const validRange = isValidAccountingDateRange(fromDate, toDate);
  const preferenceReady = preferredSiteId !== null;

  const vouchersQuery = trpc.reports.accounting.vouchers.useQuery(input, {
    enabled: validRange && preferenceReady,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  // Memoized so the `?? []` fallback does not mint a new array every
  // render and re-run the totals memo (and the lint that pins it).
  const vouchers = useMemo(
    () => (validRange ? (vouchersQuery.data?.vouchers ?? []) : []),
    [validRange, vouchersQuery.data]
  );
  const truncated = validRange && (vouchersQuery.data?.truncated ?? false);

  const totals = useMemo(() => {
    let total = 0;
    let iva = 0;
    let inc = 0;
    for (const voucher of vouchers) {
      const sign = voucher.kind === 'refund' ? -1 : 1;
      total += voucher.kind === 'refund' ? -voucher.refundAmount : voucher.total;
      iva += voucher.ivaAmount * sign;
      inc += voucher.incAmount * sign;
    }
    return { total, iva, inc };
  }, [vouchers]);

  const rangeSuffix = `${fromDate}_${toDate}`;

  // Blockers: exporting any of these states would hand the accountant
  // a file that silently misstates the period.
  const unreconciled = vouchers.filter(voucher => !voucher.taxReconciled);
  const paymentUnreconciled = vouchers.filter(voucher => !voucher.paymentReconciled);
  const saleVoucherCount = vouchers.filter(voucher => voucher.kind === 'sale').length;
  const siigoCollisions = useMemo(() => findSiigoConsecutiveCollisions(vouchers), [vouchers]);
  const blocked =
    !validRange || truncated || unreconciled.length > 0 || paymentUnreconciled.length > 0;
  const siigoBlocked = blocked || siigoCollisions.length > 0;

  const handleExportSiigo = async () => {
    const chunks = chunkSiigoRows(buildSiigoInvoiceRows(vouchers));
    setSiigoExporting(true);
    setSiigoExportError(false);
    setSiigoFileCount(null);
    try {
      const result = await exportSiigoChunks(
        chunks,
        SIIGO_COLUMNS,
        `siigo-facturas-${rangeSuffix}`
      );
      if (result.downloadedAsZip) setSiigoFileCount(result.fileCount);
    } catch {
      setSiigoExportError(true);
    } finally {
      setSiigoExporting(false);
    }
  };

  const journalColumns: ExportColumn<JournalEntryRow>[] = [
    { key: 'voucher', header: t('accounting.journal.voucher') },
    { key: 'date', header: t('accounting.journal.date') },
    { key: 'thirdPartyId', header: t('accounting.journal.thirdPartyId') },
    { key: 'thirdPartyName', header: t('accounting.journal.thirdPartyName') },
    { key: 'account', header: t('accounting.journal.account') },
    { key: 'description', header: t('accounting.journal.entryDescription') },
    { key: 'debit', header: t('accounting.journal.debit') },
    { key: 'credit', header: t('accounting.journal.credit') },
  ];

  const handleExportJournal = () => {
    if (!accountsDraft) return;
    exportToCSV(
      buildJournalEntries(vouchers, accountsDraft),
      journalColumns,
      `comprobantes-${rangeSuffix}`,
      { includeTimestamp: false }
    );
  };

  const updatePaymentAccount = (method: (typeof PAYMENT_ACCOUNT_KEYS)[number], account: string) => {
    setAccountsSaved(false);
    setAccountsDraftOverride(current => {
      const base = current ?? accountsDraft;
      return base
        ? {
            ...base,
            paymentMethods: { ...base.paymentMethods, [method]: account },
          }
        : current;
    });
  };

  const updateLedgerAccount = (key: (typeof LEDGER_ACCOUNT_KEYS)[number], account: string) => {
    setAccountsSaved(false);
    setAccountsDraftOverride(current => {
      const base = current ?? accountsDraft;
      return base ? { ...base, [key]: account } : current;
    });
  };

  const handleSaveAccounts = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accountsAreValid(accountsDraft)) return;
    updateAccountsMutation.mutate(accountsDraft);
  };

  const handleSiteChange = (nextSiteId: string) => {
    setSiteSelectionOverride(nextSiteId);
    rememberSiteMutation.reset();
    rememberSiteMutation.mutate({ siteId: nextSiteId || null });
  };

  const genericColumns: ExportColumn<GenericVoucherRow>[] = (
    [
      'eventType',
      'eventId',
      'saleNumber',
      'date',
      'site',
      'customerName',
      'customerTaxId',
      'product',
      'sku',
      'quantity',
      'unitPrice',
      'lineDiscount',
      'taxKind',
      'taxRate',
      'taxAmount',
      'lineTotal',
      'saleSubtotal',
      'saleDiscount',
      'saleIva',
      'saleInc',
      'saleTip',
      'saleServiceCharge',
      'saleTotal',
      'paymentMethods',
      'currency',
      'fiscalDocument',
      'fiscalCufe',
      'fiscalStatus',
    ] as const
  ).map(key => ({ key, header: t(`accounting.generic.${key}`) }));

  const handleExportGeneric = () => {
    exportToCSV(
      buildGenericVoucherRows(vouchers),
      genericColumns,
      `ventas-detalle-${rangeSuffix}`,
      {
        includeTimestamp: false,
      }
    );
  };

  const isEmpty =
    validRange && preferenceReady && !vouchersQuery.isLoading && vouchers.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <p className="pv-kicker">{t('accounting.kicker')}</p>
        <h1 className="pv-title text-2xl">{t('accounting.title')}</h1>
        <p className="mt-2 text-sm text-secondary-500">{t('accounting.description')}</p>
      </header>

      <div className="card p-4">
        <div className="flex flex-wrap gap-4">
          <label className="block">
            <span className="label">{t('accounting.filters.from')}</span>
            <input
              type="date"
              className="input"
              value={fromDate}
              max={toDate}
              aria-invalid={!validRange}
              aria-describedby={!validRange ? 'accounting-invalid-range' : undefined}
              onChange={event => setFromDate(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">{t('accounting.filters.to')}</span>
            <input
              type="date"
              className="input"
              value={toDate}
              min={fromDate}
              aria-invalid={!validRange}
              aria-describedby={!validRange ? 'accounting-invalid-range' : undefined}
              onChange={event => setToDate(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">{t('accounting.filters.site')}</span>
            <select
              className="input"
              value={selectedSiteId}
              onChange={event => handleSiteChange(event.target.value)}
              disabled={!preferenceReady}
              data-testid="accounting-site-filter"
            >
              <option value="">{t('accounting.filters.allSites')}</option>
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {rememberSiteMutation.isSuccess ? (
          <p className="mt-3 text-sm text-success-700" role="status">
            {t('accounting.filters.siteSaved')}
          </p>
        ) : null}
        {rememberSiteMutation.error ? (
          <p className="mt-3 text-sm text-danger-700" role="alert">
            {translateServerError(
              rememberSiteMutation.error,
              t,
              t('accounting.filters.siteSaveError')
            )}
          </p>
        ) : null}
        {sitesQuery.error ? (
          <p className="mt-3 text-sm text-danger-700" role="alert">
            {t('accounting.filters.siteLoadError')}
          </p>
        ) : null}
      </div>

      <details className="card p-5" data-testid="accounting-puc-settings">
        <summary className="cursor-pointer font-semibold text-secondary-950">
          {t('accounting.settings.title')}
        </summary>
        <p className="mt-2 text-sm text-secondary-500">
          {t('accounting.settings.description', {
            version: settingsQuery.data?.pucDefaultsVersion ?? 1,
          })}
        </p>
        {settingsQuery.error ? (
          <p className="mt-3 text-sm text-danger-700" role="alert">
            {translateServerError(settingsQuery.error, t, t('accounting.settings.loadError'))}
          </p>
        ) : null}
        {accountsDraft ? (
          <form className="mt-4 space-y-4" onSubmit={handleSaveAccounts}>
            <fieldset>
              <legend className="label">{t('accounting.settings.paymentAccounts')}</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {PAYMENT_ACCOUNT_KEYS.map(method => (
                  <label className="block" key={method}>
                    <span className="text-xs font-medium text-secondary-600">
                      {t(`accounting.settings.fields.${method}`)}
                    </span>
                    <input
                      className="input mt-1"
                      inputMode="numeric"
                      pattern="[1-9][0-9]{3,11}"
                      minLength={4}
                      maxLength={12}
                      required
                      value={accountsDraft.paymentMethods[method]}
                      onChange={event => updatePaymentAccount(method, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">{t('accounting.settings.ledgerAccounts')}</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {LEDGER_ACCOUNT_KEYS.map(key => (
                  <label className="block" key={key}>
                    <span className="text-xs font-medium text-secondary-600">
                      {t(`accounting.settings.fields.${key}`)}
                    </span>
                    <input
                      className="input mt-1"
                      inputMode="numeric"
                      pattern="[1-9][0-9]{3,11}"
                      minLength={4}
                      maxLength={12}
                      required
                      value={accountsDraft[key]}
                      onChange={event => updateLedgerAccount(key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-secondary-500">{t('accounting.settings.codeHint')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={!accountsAreValid(accountsDraft) || updateAccountsMutation.isPending}
                data-testid="accounting-save-puc"
              >
                <Save aria-hidden="true" />
                {t('accounting.settings.save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const defaults = settingsQuery.data?.defaults;
                  if (defaults) {
                    setAccountsDraftOverride(cloneAccounts(defaults));
                    setAccountsSaved(false);
                  }
                }}
                disabled={!settingsQuery.data?.defaults}
              >
                <RotateCcw aria-hidden="true" />
                {t('accounting.settings.restoreDefaults')}
              </Button>
              {accountsSaved ? (
                <span className="text-sm text-success-700" role="status">
                  {t('accounting.settings.saved')}
                </span>
              ) : null}
            </div>
            {updateAccountsMutation.error ? (
              <p className="text-sm text-danger-700" role="alert">
                {translateServerError(
                  updateAccountsMutation.error,
                  t,
                  t('accounting.settings.saveError')
                )}
              </p>
            ) : null}
          </form>
        ) : null}
      </details>

      {!validRange ? (
        <div
          id="accounting-invalid-range"
          className="rounded-2xl border border-warning-300/70 bg-warning-50 px-4 py-3 text-sm text-warning-900"
          role="alert"
          data-testid="accounting-invalid-range"
        >
          {t('accounting.filters.invalidRange')}
        </div>
      ) : null}

      {validRange && vouchersQuery.error ? (
        <div className="rounded-2xl border border-danger-300/70 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(vouchersQuery.error, t, t('errors:server.unknown'))}
        </div>
      ) : null}
      {truncated ? (
        <div
          className="rounded-2xl border border-danger-300/70 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          role="alert"
          data-testid="accounting-truncated"
        >
          {t('accounting.truncated')}
        </div>
      ) : null}
      {unreconciled.length > 0 ? (
        <div
          className="rounded-2xl border border-danger-300/70 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          role="alert"
          data-testid="accounting-unreconciled"
        >
          {t('accounting.unreconciled', {
            count: unreconciled.length,
            sales: unreconciled
              .slice(0, 5)
              .map(voucher => voucher.saleNumber)
              .join(', '),
          })}
        </div>
      ) : null}
      {paymentUnreconciled.length > 0 ? (
        <div
          className="rounded-2xl border border-danger-300/70 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          role="alert"
          data-testid="accounting-payment-unreconciled"
        >
          {t('accounting.paymentUnreconciled', {
            count: paymentUnreconciled.length,
            sales: paymentUnreconciled
              .slice(0, 5)
              .map(voucher => voucher.saleNumber)
              .join(', '),
          })}
        </div>
      ) : null}
      {siigoCollisions.length > 0 ? (
        <div
          className="rounded-2xl border border-warning-300/70 bg-warning-50 px-4 py-3 text-sm text-warning-900"
          role="alert"
          data-testid="accounting-collisions"
        >
          {t('accounting.siigoCollision', { consecutives: siigoCollisions.slice(0, 5).join(', ') })}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiTile
          icon={BookOpenCheck}
          label={t('accounting.kpi.vouchers')}
          value={String(vouchers.length)}
        />
        <KpiTile
          icon={Table2}
          label={t('accounting.kpi.total')}
          value={formatCurrency(totals.total)}
        />
        <KpiTile
          icon={FileSpreadsheet}
          label={t('accounting.kpi.taxes')}
          value={`${formatCurrency(totals.iva)} · ${formatCurrency(totals.inc)}`}
        />
      </div>

      {isEmpty ? (
        <EmptyState
          icon={BookOpenCheck}
          title={t('accounting.empty.title')}
          description={t('accounting.empty.description')}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="card space-y-3 p-5">
            <h2 className="text-base font-semibold text-secondary-950">
              {t('accounting.siigo.title')}
            </h2>
            <p className="text-sm text-secondary-500">{t('accounting.siigo.description')}</p>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleExportSiigo()}
              disabled={saleVoucherCount === 0 || siigoBlocked || siigoExporting}
              data-testid="accounting-export-siigo"
            >
              <Download aria-hidden="true" />
              {t('accounting.siigo.cta')}
            </Button>
            {siigoFileCount !== null ? (
              <p className="text-sm text-secondary-600" role="status">
                {t('accounting.siigo.multiFile', { count: siigoFileCount })}
              </p>
            ) : null}
            {siigoExportError ? (
              <p className="text-sm text-danger-700" role="alert">
                {t('accounting.siigo.exportError')}
              </p>
            ) : null}
          </section>
          <section className="card space-y-3 p-5">
            <h2 className="text-base font-semibold text-secondary-950">
              {t('accounting.journal.title')}
            </h2>
            <p className="text-sm text-secondary-500">{t('accounting.journal.description')}</p>
            <Button
              type="button"
              variant="primary"
              onClick={handleExportJournal}
              disabled={vouchers.length === 0 || blocked || !accountsAreValid(accountsDraft)}
              data-testid="accounting-export-journal"
            >
              <Download aria-hidden="true" />
              {t('accounting.journal.cta')}
            </Button>
          </section>
          <section className="card space-y-3 p-5">
            <h2 className="text-base font-semibold text-secondary-950">
              {t('accounting.generic.title')}
            </h2>
            <p className="text-sm text-secondary-500">{t('accounting.generic.description')}</p>
            <Button
              type="button"
              variant="primary"
              onClick={handleExportGeneric}
              disabled={vouchers.length === 0 || blocked}
              data-testid="accounting-export-generic"
            >
              <Download aria-hidden="true" />
              {t('accounting.generic.cta')}
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
