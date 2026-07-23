/**
 * Card admin para los ajustes fiscales del pack México.
 *
 * Vive dentro del tab `Fiscal` de `CompanyPage`. Lee
 * `fiscalSettings.getByCountry({ MX })`, escribe vía
 * `fiscalSettings.updateMx`, y muestra un badge de readiness con
 * los issues que el adapter MX reporta cuando faltan campos
 * (RFC, régimen fiscal, lugar de expedición, ambiente).
 *
 * El adaptador genera CFDI 4.0 estructural en estado draft. Esta card
 * captura la configuración y muestra su readiness; firma CSD,
 * transmisión PAC y cancelación SAT siguen fuera del alcance actual.
 *
 * Cuando el `countryCode` del tenant no es MX, la card muestra un
 * placeholder en lugar de los campos. CO y CL tienen sus propias cards.
 *
 * el contenido del panel adopta las recetas pv-*:
 * encabezado `.pv-kicker`/`.pv-title` con glifo tonal, formulario
 * con `.pv-field`/`.pv-input` (vía `SimpleFormField`), readiness con
 * `Badge` tipado + checklist `.pv-check`, y acción `Button` primary.
 * La lógica (FormData uncontrolled + tRPC) se conserva intacta.
 */
import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSignature } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FiscalMaturityBadge } from '@/components/fiscal/FiscalMaturityBadge';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { Badge, Button } from '@/components/ui';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
const REGIMEN_OPTIONS: ReadonlyArray<{
  code: string;
  name: string;
}> = [
  {
    code: '601',
    name: '601 — General de Ley Personas Morales',
  },
  {
    code: '603',
    name: '603 — Personas Morales con Fines no Lucrativos',
  },
  {
    code: '605',
    name: '605 — Sueldos y Salarios',
  },
  {
    code: '606',
    name: '606 — Arrendamiento',
  },
  {
    code: '607',
    name: '607 — Régimen de Enajenación o Adquisición de Bienes',
  },
  {
    code: '608',
    name: '608 — Demás ingresos',
  },
  {
    code: '609',
    name: '609 — Consolidación',
  },
  {
    code: '610',
    name: '610 — Residentes en el Extranjero',
  },
  {
    code: '611',
    name: '611 — Ingresos por Dividendos',
  },
  {
    code: '612',
    name: '612 — Personas Físicas con Actividades Empresariales y Profesionales',
  },
  {
    code: '614',
    name: '614 — Ingresos por intereses',
  },
  {
    code: '615',
    name: '615 — Régimen de los ingresos por obtención de premios',
  },
  {
    code: '616',
    name: '616 — Sin obligaciones fiscales',
  },
  {
    code: '620',
    name: '620 — Sociedades Cooperativas de Producción',
  },
  {
    code: '621',
    name: '621 — Incorporación Fiscal',
  },
  {
    code: '622',
    name: '622 — Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  },
  {
    code: '623',
    name: '623 — Opcional para Grupos de Sociedades',
  },
  {
    code: '624',
    name: '624 — Coordinados',
  },
  {
    code: '625',
    name: '625 — Régimen Plataformas Tecnológicas',
  },
  {
    code: '626',
    name: '626 — Régimen Simplificado de Confianza (RESICO)',
  },
  {
    code: '628',
    name: '628 — Hidrocarburos',
  },
  {
    code: '629',
    name: '629 — Regímenes Fiscales Preferentes y Multinacionales',
  },
  {
    code: '630',
    name: '630 — Enajenación de acciones en bolsa de valores',
  },
];
function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}
export function CompanyMxFiscalCard() {
  const { t } = useTranslation(['fiscal', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  // El `countryCode` del tenant viene del resolver de locale. MX muestra
  // el formulario; CO y CL muestran su configuración correspondiente.
  const localeQuery = trpc.tenantLocale.get.useQuery();
  const tenantCountry = localeQuery.data?.countryCode ?? 'CO';
  const settingsQuery = trpc.fiscalSettings.getByCountry.useQuery(
    {
      countryCode: 'MX',
    },
    {
      enabled: tenantCountry === 'MX',
    }
  );
  const mxSettings = settingsQuery.data?.countryCode === 'MX' ? settingsQuery.data.settings : null;

  // Fiscal "sin configurar" = no hay ningún dato significativo capturado
  // todavía (pack apagado y todos los campos vacíos). El `environment`
  // siempre trae un default ('sandbox') así que no cuenta como
  // configuración. En ese estado mostramos un EmptyState con un CTA
  // "Configurar" en vez de un form vacío; con datos existentes el form
  // se renderiza directo como antes.
  const isConfigured = Boolean(
    mxSettings &&
    (mxSettings.enabled ||
      mxSettings.rfc ||
      mxSettings.regimenFiscalCode ||
      mxSettings.lugarExpedicion)
  );
  const [revealed, setRevealed] = useState(false);
  const showForm = isConfigured || revealed;
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
      toast.success({
        title: t('fiscal:settings.mx.toast.saved'),
      });
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
    const nextRegimenFiscalCode = getFormString(formData, 'regimenFiscalCode');
    const nextLugarExpedicion = getFormString(formData, 'lugarExpedicion').trim();
    await updateMutation.mutateAsync({
      enabled: formData.get('enabled') === 'on',
      rfc: nextRfc.length > 0 ? nextRfc : null,
      regimenFiscalCode: nextRegimenFiscalCode.length > 0 ? nextRegimenFiscalCode : null,
      lugarExpedicion: nextLugarExpedicion.length > 0 ? nextLugarExpedicion : null,
      environment: nextEnvironment === 'production' ? 'production' : 'sandbox',
    });
  };

  // Defensive:  renderizaba placeholders para CO/CL aquí.
  // movió ese dispatch a CompanyPage, así que la card MX
  // ahora asume que se renderiza únicamente cuando tenantCountry
  // === 'MX'. Esta guarda existe por si alguien reutiliza el
  // componente fuera del tab Fiscal de CompanyPage.
  if (tenantCountry !== 'MX') {
    return null;
  }

  // Render principal: tenant MX. Form + readiness badge.
  return (
    <section className="card space-y-6 p-6">
      <div className="flex items-center gap-3">
        <span className="glyph-tile glyph-tile-primary h-11 w-11">
          <FileSignature className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <div className="pv-kicker">{t('fiscal:settings.mx.kicker')}</div>
          <h2 className="pv-title text-lg">{t('fiscal:settings.mx.title')}</h2>
        </div>
      </div>

      {/* Badge de readiness */}
      {validation && (
        <div className="space-y-3" aria-live="polite" data-testid="fiscal-mx-readiness">
          <Badge variant={isReady ? 'success' : 'danger'}>
            {isReady ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isReady
              ? t('fiscal:settings.readiness.ready')
              : t('fiscal:settings.readiness.notReady')}
          </Badge>
          {/* CFDI emission is an unsigned draft today (optional). */}
          {settingsQuery.data?.maturity && (
            <FiscalMaturityBadge maturity={settingsQuery.data.maturity} className="ml-2" />
          )}
          {!isReady && issueLabels.length > 0 && (
            <div className="surface-panel-muted">
              {issueLabels.map(issue => (
                <div key={issue.code} className="pv-check">
                  <span className="ic block">
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="grow">
                    <div className="t text-sm">{issue.label}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showForm ? (
        <div data-testid="fiscal-mx-empty">
          <EmptyState
            icon={FileSignature}
            title={t('fiscal:settings.mx.emptyTitle')}
            description={t('fiscal:settings.mx.emptyDescription')}
            className="px-6 py-8"
            action={
              <Button
                type="button"
                data-testid="fiscal-mx-configure"
                onClick={() => setRevealed(true)}
                variant="primary"
              >
                {t('fiscal:settings.mx.emptyCta')}
              </Button>
            }
          />
        </div>
      ) : (
        <form key={formKey} onSubmit={handleSubmit} className="space-y-5">
          <label className="flex items-center gap-3 text-sm font-medium text-secondary-800">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={mxSettings?.enabled ?? false}
              className="h-4 w-4 shrink-0 rounded border-line-strong text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-400"
              aria-label={t('fiscal:settings.mx.fields.enabled')}
            />
            <span className="flex flex-col gap-0.5">
              <span>{t('fiscal:settings.mx.fields.enabled')}</span>
              <span className="text-xs font-normal text-secondary-500">
                {t('fiscal:settings.mx.fields.enabledHelp')}
              </span>
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <SimpleFormField
              label={t('fiscal:settings.mx.fields.rfc')}
              htmlFor="fiscal-mx-rfc"
              helperText={t('fiscal:settings.mx.fields.rfcHelp')}
            >
              <input
                id="fiscal-mx-rfc"
                name="rfc"
                type="text"
                defaultValue={mxSettings?.rfc ?? ''}
                placeholder={t('fiscal:settings.mx.fields.rfcPlaceholder')}
                className="pv-input"
                maxLength={13}
              />
            </SimpleFormField>

            <SimpleFormField
              label={t('fiscal:settings.mx.fields.regimen')}
              htmlFor="fiscal-mx-regimen"
            >
              <select
                id="fiscal-mx-regimen"
                name="regimenFiscalCode"
                defaultValue={mxSettings?.regimenFiscalCode ?? ''}
                className="pv-input"
              >
                <option value="">{t('fiscal:settings.mx.fields.regimenPlaceholder')}</option>
                {REGIMEN_OPTIONS.map(opt => (
                  <option key={opt.code} value={opt.code}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </SimpleFormField>

            <SimpleFormField label={t('fiscal:settings.mx.fields.lugar')} htmlFor="fiscal-mx-lugar">
              <input
                id="fiscal-mx-lugar"
                name="lugarExpedicion"
                type="text"
                defaultValue={mxSettings?.lugarExpedicion ?? ''}
                placeholder={t('fiscal:settings.mx.fields.lugarPlaceholder')}
                className="pv-input"
                maxLength={5}
              />
            </SimpleFormField>

            <SimpleFormField
              label={t('fiscal:settings.mx.fields.environment')}
              htmlFor="fiscal-mx-environment"
            >
              <select
                id="fiscal-mx-environment"
                name="environment"
                defaultValue={mxSettings?.environment ?? 'sandbox'}
                className="pv-input"
              >
                <option value="sandbox">{t('fiscal:settings.mx.fields.environmentSandbox')}</option>
                <option value="production">
                  {t('fiscal:settings.mx.fields.environmentProduction')}
                </option>
              </select>
            </SimpleFormField>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending} variant="primary">
              {updateMutation.isPending
                ? t('fiscal:settings.mx.actions.saving')
                : t('fiscal:settings.mx.actions.save')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
