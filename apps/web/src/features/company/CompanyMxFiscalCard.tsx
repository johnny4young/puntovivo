/**
 * ENG-035a — Card admin para los ajustes fiscales del pack México.
 *
 * Vive dentro del tab `Fiscal` de `CompanyPage`. Lee
 * `fiscalSettings.getByCountry({ MX })`, escribe vía
 * `fiscalSettings.updateMx`, y muestra un badge de readiness con
 * los issues que el adapter MX reporta cuando faltan campos
 * (RFC, régimen fiscal, lugar de expedición, ambiente).
 *
 * La emisión real de CFDI 4.0 sigue parqueada hasta ENG-035b
 * (modelado XML) + ENG-035c (integración PAC + firma). Esta card
 * cubre sólo la captura de configuración + el probe de readiness
 * — espejo del shape de `CompanyAISettingsCard` (ENG-030).
 *
 * Cuando el `countryCode` del tenant no es MX, la card muestra un
 * placeholder en lugar de los campos. CO + CL traen sus propias
 * cards en ENG-035c / ENG-036; aquí solo apuntamos al ticket que
 * lo trae.
 */
import { useMemo } from 'react';
import { CheckCircle2, FileSignature, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

const REGIMEN_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: '601', name: '601 — General de Ley Personas Morales' },
  { code: '603', name: '603 — Personas Morales con Fines no Lucrativos' },
  { code: '605', name: '605 — Sueldos y Salarios' },
  { code: '606', name: '606 — Arrendamiento' },
  { code: '607', name: '607 — Régimen de Enajenación o Adquisición de Bienes' },
  { code: '608', name: '608 — Demás ingresos' },
  { code: '609', name: '609 — Consolidación' },
  { code: '610', name: '610 — Residentes en el Extranjero' },
  { code: '611', name: '611 — Ingresos por Dividendos' },
  { code: '612', name: '612 — Personas Físicas con Actividades Empresariales y Profesionales' },
  { code: '614', name: '614 — Ingresos por intereses' },
  { code: '615', name: '615 — Régimen de los ingresos por obtención de premios' },
  { code: '616', name: '616 — Sin obligaciones fiscales' },
  { code: '620', name: '620 — Sociedades Cooperativas de Producción' },
  { code: '621', name: '621 — Incorporación Fiscal' },
  { code: '622', name: '622 — Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { code: '623', name: '623 — Opcional para Grupos de Sociedades' },
  { code: '624', name: '624 — Coordinados' },
  { code: '625', name: '625 — Régimen Plataformas Tecnológicas' },
  { code: '626', name: '626 — Régimen Simplificado de Confianza (RESICO)' },
  { code: '628', name: '628 — Hidrocarburos' },
  { code: '629', name: '629 — Regímenes Fiscales Preferentes y Multinacionales' },
  { code: '630', name: '630 — Enajenación de acciones en bolsa de valores' },
];

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export function CompanyMxFiscalCard() {
  const { t } = useTranslation(['fiscal', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  // El `countryCode` del tenant lo leemos del resolver de locale
  // (ENG-017). Cuando el tenant es MX renderizamos el form; cuando
  // es CO/CL el placeholder apunta al ticket pendiente.
  const localeQuery = trpc.tenantLocale.get.useQuery();
  const tenantCountry = localeQuery.data?.countryCode ?? 'CO';

  const settingsQuery = trpc.fiscalSettings.getByCountry.useQuery(
    { countryCode: 'MX' },
    { enabled: tenantCountry === 'MX' }
  );

  const mxSettings =
    settingsQuery.data?.countryCode === 'MX' ? settingsQuery.data.settings : null;
  const formKey = mxSettings
    ? [
        mxSettings.enabled,
        mxSettings.rfc ?? '',
        mxSettings.regimenFiscalCode ?? '',
        mxSettings.lugarExpedicion ?? '',
        mxSettings.environment,
      ].join('|')
    : 'empty';

  const updateMutation = trpc.fiscalSettings.updateMx.useMutation({
    onSuccess: async () => {
      toast.success({ title: t('fiscal:settings.mx.toast.saved') });
      await utils.fiscalSettings.getByCountry.invalidate({
        countryCode: 'MX',
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'fiscal:settings.mx.toast.saveError',
    }),
  });

  const validation = settingsQuery.data?.validation;
  const isReady = validation?.ok ?? false;

  const issueLabels = useMemo(() => {
    if (!validation) return [];
    return validation.issues.map(issue => ({
      code: issue.code,
      label: t(`fiscal:settings.readiness.issueCodes.${issue.code}`, {
        defaultValue: issue.message,
      }),
    }));
  }, [validation, t]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextEnvironment = getFormString(formData, 'environment');
    const nextRfc = getFormString(formData, 'rfc').trim();
    const nextRegimenFiscalCode = getFormString(
      formData,
      'regimenFiscalCode'
    );
    const nextLugarExpedicion = getFormString(
      formData,
      'lugarExpedicion'
    ).trim();

    await updateMutation.mutateAsync({
      enabled: formData.get('enabled') === 'on',
      rfc: nextRfc.length > 0 ? nextRfc : null,
      regimenFiscalCode:
        nextRegimenFiscalCode.length > 0 ? nextRegimenFiscalCode : null,
      lugarExpedicion:
        nextLugarExpedicion.length > 0 ? nextLugarExpedicion : null,
      environment:
        nextEnvironment === 'production' ? 'production' : 'sandbox',
    });
  };

  // Defensive: ENG-035a renderizaba placeholders para CO/CL aquí.
  // ENG-036a movió ese dispatch a CompanyPage, así que la card MX
  // ahora asume que se renderiza únicamente cuando tenantCountry
  // === 'MX'. Esta guarda existe por si alguien reutiliza el
  // componente fuera del tab Fiscal de CompanyPage.
  if (tenantCountry !== 'MX') {
    return null;
  }

  // Render principal: tenant MX. Form + readiness badge.
  return (
    <div className="card p-6 space-y-6">
      <div className="flex items-start gap-3">
        <FileSignature className="h-6 w-6 text-primary-700" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-950">
            {t('fiscal:settings.mx.title')}
          </h2>
          <p className="text-sm text-secondary-600">
            {t('fiscal:settings.mx.description')}
          </p>
        </div>
      </div>

      {/* Badge de readiness */}
      {validation && (
        <div
          className={`rounded-xl border p-4 flex items-start gap-3 ${
            isReady
              ? 'border-success-200 bg-success-50 text-success-700'
              : 'border-warning-200 bg-warning-50 text-warning-700'
          }`}
          aria-live="polite"
          data-testid="fiscal-mx-readiness"
        >
          {isReady ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 shrink-0" />
          )}
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {isReady
                ? t('fiscal:settings.readiness.ready')
                : t('fiscal:settings.readiness.notReady')}
            </p>
            {!isReady && issueLabels.length > 0 && (
              <ul className="text-xs space-y-1">
                {issueLabels.map(issue => (
                  <li key={issue.code}>• {issue.label}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <form key={formKey} onSubmit={handleSubmit} className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-secondary-700">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={mxSettings?.enabled ?? false}
            aria-label={t('fiscal:settings.mx.fields.enabled')}
          />
          <span>{t('fiscal:settings.mx.fields.enabled')}</span>
        </label>
        <p className="text-xs text-secondary-500 -mt-2">
          {t('fiscal:settings.mx.fields.enabledHelp')}
        </p>

        <div>
          <label
            htmlFor="fiscal-mx-rfc"
            className="block text-sm font-medium text-secondary-700"
          >
            {t('fiscal:settings.mx.fields.rfc')}
          </label>
          <input
            id="fiscal-mx-rfc"
            name="rfc"
            type="text"
            defaultValue={mxSettings?.rfc ?? ''}
            placeholder={t('fiscal:settings.mx.fields.rfcPlaceholder')}
            className="input mt-1"
            maxLength={13}
          />
          <p className="mt-1 text-xs text-secondary-500">
            {t('fiscal:settings.mx.fields.rfcHelp')}
          </p>
        </div>

        <div>
          <label
            htmlFor="fiscal-mx-regimen"
            className="block text-sm font-medium text-secondary-700"
          >
            {t('fiscal:settings.mx.fields.regimen')}
          </label>
          <select
            id="fiscal-mx-regimen"
            name="regimenFiscalCode"
            defaultValue={mxSettings?.regimenFiscalCode ?? ''}
            className="input mt-1"
          >
            <option value="">
              {t('fiscal:settings.mx.fields.regimenPlaceholder')}
            </option>
            {REGIMEN_OPTIONS.map(opt => (
              <option key={opt.code} value={opt.code}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="fiscal-mx-lugar"
            className="block text-sm font-medium text-secondary-700"
          >
            {t('fiscal:settings.mx.fields.lugar')}
          </label>
          <input
            id="fiscal-mx-lugar"
            name="lugarExpedicion"
            type="text"
            defaultValue={mxSettings?.lugarExpedicion ?? ''}
            placeholder={t('fiscal:settings.mx.fields.lugarPlaceholder')}
            className="input mt-1"
            maxLength={5}
          />
        </div>

        <div>
          <label
            htmlFor="fiscal-mx-environment"
            className="block text-sm font-medium text-secondary-700"
          >
            {t('fiscal:settings.mx.fields.environment')}
          </label>
          <select
            id="fiscal-mx-environment"
            name="environment"
            defaultValue={mxSettings?.environment ?? 'sandbox'}
            className="input mt-1"
          >
            <option value="sandbox">
              {t('fiscal:settings.mx.fields.environmentSandbox')}
            </option>
            <option value="production">
              {t('fiscal:settings.mx.fields.environmentProduction')}
            </option>
          </select>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="btn-primary"
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending
              ? t('fiscal:settings.mx.actions.saving')
              : t('fiscal:settings.mx.actions.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
