import { useState } from 'react';
import { Database, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

const SAMPLE_COLOMBIA_INVIMA_CSV = [
  'expediente;consecutivocum;producto;titular;registrosanitario;fechavencimiento;estadoregistro;descripcioncomercial;principioactivo;cantidad;unidadmedida;formafarmaceutica;viaadministracion;condicionventa',
  '19991001;01;ACETAMINOFEN 500 MG TABLETA;LABORATORIOS MK S.A.;INVIMA 2024M-0001234-R2;31/12/2029;Vigente;CAJA X 30 TABLETAS;ACETAMINOFEN;500;mg;TABLETA;ORAL;Venta libre',
  '19992002;01;AMOXICILINA 500 MG CAPSULA;GENFAR S.A.;INVIMA 2025M-0005678-R1;30/06/2030;Vigente;CAJA X 30 CAPSULAS;AMOXICILINA;500;mg;CAPSULA;ORAL;Venta con formula medica',
  '19993003;01;CLONAZEPAM 2 MG TABLETA;PRODUCTOS ROCHE S.A.;INVIMA 2023M-0009911;15/09/2028;Vigente;CAJA X 30 TABLETAS;CLONAZEPAM;2;mg;TABLETA;ORAL;Medicamento de control especial',
].join('\n');

const STATUS_BADGE = {
  vigente: 'success',
  en_tramite_renovacion: 'warning',
  vencido: 'danger',
  cancelado: 'danger',
  suspendido: 'danger',
} as const;

export function PharmacyInvimaPanel() {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [csvText, setCsvText] = useState('');
  const [syncMatchingProducts, setSyncMatchingProducts] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 200);

  const catalogQuery = trpc.pharmacy.searchInvimaCatalog.useQuery({
    search: debouncedSearch || undefined,
    page: 1,
    perPage: 25,
  });

  const importMutation = trpc.pharmacy.importInvimaCatalog.useMutation({
    onSuccess: async data => {
      await Promise.all([
        utils.pharmacy.searchInvimaCatalog.invalidate(),
        utils.products.list.invalidate(),
      ]);
      toast.success({
        title:
          data.skipped > 0
            ? t('pharmacy:invima.toast.importedWithSkipped', { count: data.skipped })
            : t('pharmacy:invima.toast.imported'),
        description: t('pharmacy:invima.toast.summary', {
          inserted: data.inserted,
          updated: data.updated,
          linked: data.linkedProducts,
        }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:invima.toast.error' }),
  });

  return (
    <div
      className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
      data-testid="pharmacy-invima-panel"
    >
      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2.5">
          <Upload className="h-5 w-5 text-primary-700" aria-hidden="true" />
          <h3 className="font-semibold text-secondary-950">{t('pharmacy:invima.importTitle')}</h3>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="btn-outline inline-flex cursor-pointer items-center gap-2 text-xs">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {t('pharmacy:invima.uploadFile')}
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              className="sr-only"
              onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 2_000_000) {
                  toast.error({ title: t('pharmacy:invima.toast.fileTooLarge') });
                  event.target.value = '';
                  return;
                }
                const text = await file.text();
                setCsvText(text);
              }}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="compact"
            data-testid="pharmacy-invima-load-sample"
            onClick={() => setCsvText(SAMPLE_COLOMBIA_INVIMA_CSV)}
          >
            {t('pharmacy:invima.loadSample')}
          </Button>
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-invima-csv">
            {t('pharmacy:invima.csvLabel')}
          </label>
          <textarea
            id="pharmacy-invima-csv"
            data-testid="pharmacy-invima-csv"
            rows={7}
            className="pv-input font-mono text-xs"
            value={csvText}
            placeholder={t('pharmacy:invima.csvPlaceholder')}
            onChange={e => setCsvText(e.target.value)}
          />
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            checked={syncMatchingProducts}
            onChange={e => setSyncMatchingProducts(e.target.checked)}
          />
          {t('pharmacy:invima.syncProducts')}
        </label>

        <Button
          type="button"
          data-testid="pharmacy-invima-import"
          disabled={!csvText.trim() || importMutation.isPending}
          onClick={() => importMutation.mutate({ csvText, syncMatchingProducts })}
        >
          {t('pharmacy:invima.importAction')}
        </Button>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2.5">
          <Database className="h-5 w-5 text-primary-700" aria-hidden="true" />
          <h3 className="font-semibold text-secondary-950">{t('pharmacy:invima.searchTitle')}</h3>
        </div>

        <input
          type="search"
          data-testid="pharmacy-invima-search"
          className="pv-input w-full"
          value={search}
          placeholder={t('pharmacy:invima.searchPlaceholder')}
          aria-label={t('pharmacy:invima.searchPlaceholder')}
          onChange={e => setSearch(e.target.value)}
        />

        {(catalogQuery.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-secondary-500">{t('pharmacy:invima.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-secondary-200 text-xs uppercase text-secondary-500">
                <tr>
                  <th className="py-2 pr-3">{t('pharmacy:invima.columns.cum')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:invima.columns.product')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:invima.columns.registration')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:invima.columns.status')}</th>
                  <th className="py-2">{t('pharmacy:invima.columns.classification')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {catalogQuery.data?.items.map(entry => (
                  <tr key={entry.id} data-testid="pharmacy-invima-row">
                    <td className="py-2.5 pr-3 font-mono text-xs text-secondary-800">
                      {entry.cumCode}
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-secondary-950">{entry.productName}</div>
                      <div className="text-xs text-secondary-500">
                        {entry.activeIngredient}
                        {entry.concentration ? ` · ${entry.concentration}` : ''}
                        {entry.presentation ? ` · ${entry.presentation}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-secondary-700">
                      {entry.sanitaryRegistration}
                      {entry.registrationExpiresAt ? ` (${entry.registrationExpiresAt})` : ''}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={STATUS_BADGE[entry.registrationStatus]}>
                        {t(`pharmacy:invima.statuses.${entry.registrationStatus}`)}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-xs text-secondary-700">
                      {t(`pharmacy:product.classifications.${entry.classification}`)}
                    </td>
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
