/**
 * ENG-036a — Card admin para los ajustes fiscales del pack Chile.
 *
 * Vive dentro del tab `Fiscal` de `CompanyPage`. Lee
 * `fiscalSettings.getByCountry({ CL })`, escribe vía
 * `fiscalSettings.updateCl`, y muestra un badge de readiness con
 * los issues que el adapter CL reporta cuando faltan campos
 * (RUT, giro CIIU.cl, comuna SUBDERE, casa matriz, ambiente).
 *
 * La emisión DTE 1.0 sin firmar shippea con ENG-036b; certificación
 * SII + firma + entrega digital quedan parqueadas para ENG-036c.
 * Esta card cubre captura de configuración, readiness y el estado
 * read-only del CAF activo — espejo del shape de `CompanyMxFiscalCard`.
 *
 * El dispatch entre cards (CO / MX / CL) vive en `CompanyPage.tsx`;
 * esta card asume que se renderiza únicamente cuando el tenant es
 * CL. La defensiva (no renderiza nada si tenantCountry !== 'CL')
 * sigue como red de seguridad por si alguien la reutiliza fuera
 * del tab.
 *
 * Rediseño FASE 6 — el contenido del panel adopta las recetas pv-*:
 * encabezado `.pv-kicker`/`.pv-title` con glifo tonal, formulario
 * con `.pv-field`/`.pv-input` (vía `SimpleFormField`), readiness con
 * `.pv-badge` + checklist `.pv-check`, la sección CAF en una
 * `.surface-panel` con `EmptyState` cuando no hay folios, y acción
 * `.pv-btn primary`. La lógica (FormData uncontrolled + tRPC) se
 * conserva intacta.
 *
 * @module features/company/CompanyClFiscalCard
 */
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileSignature,
  Landmark,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { FiscalMaturityBadge } from '@/components/fiscal/FiscalMaturityBadge';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Subset curado para el Select del form. Espejo de los códigos
 * que ship en `services/fiscal/packs/cl/catalogs/giroComercial.ts`
 * (sin la rev por compactness).
 */
const GIRO_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: '4711', name: '4711 — Comercio al por menor en almacenes no especializados' },
  { code: '4719', name: '4719 — Otras actividades de venta al por menor' },
  { code: '4721', name: '4721 — Comercio al por menor de alimentos' },
  { code: '4722', name: '4722 — Comercio al por menor de bebidas' },
  { code: '4723', name: '4723 — Comercio al por menor de tabaco' },
  { code: '4730', name: '4730 — Comercio al por menor de combustible' },
  { code: '4741', name: '4741 — Computadores y software' },
  { code: '4742', name: '4742 — Equipos audio y video' },
  { code: '4751', name: '4751 — Productos textiles' },
  { code: '4752', name: '4752 — Ferretería, pintura y vidrio' },
  { code: '4759', name: '4759 — Aparatos eléctricos y muebles' },
  { code: '4761', name: '4761 — Libros, periódicos y papelería' },
  { code: '4763', name: '4763 — Artículos deportivos' },
  { code: '4771', name: '4771 — Prendas de vestir, calzado y artículos de cuero' },
  { code: '4772', name: '4772 — Productos farmacéuticos y medicinales' },
  { code: '4773', name: '4773 — Cosméticos y artículos de tocador' },
  { code: '4774', name: '4774 — Artículos de segunda mano' },
  { code: '4630', name: '4630 — Comercio al por mayor de alimentos, bebidas y tabaco' },
  { code: '4690', name: '4690 — Comercio al por mayor no especializado' },
  { code: '5610', name: '5610 — Restaurantes y servicio móvil de comidas' },
  { code: '5621', name: '5621 — Catering para eventos' },
  { code: '5630', name: '5630 — Servicio de bebidas' },
  { code: '4520', name: '4520 — Mantenimiento y reparación de vehículos automotores' },
  { code: '9511', name: '9511 — Reparación de computadores y equipo periférico' },
  { code: '9521', name: '9521 — Reparación de electrónicos de consumo' },
  { code: '9602', name: '9602 — Peluquería y tratamientos de belleza' },
];

/**
 * Subset curado para el Select del form. Espejo de
 * `services/fiscal/packs/cl/catalogs/comuna.ts`.
 */
const COMUNA_OPTIONS: ReadonlyArray<{ code: number; name: string }> = [
  // Gran Santiago
  { code: 13101, name: 'Santiago (RM)' },
  { code: 13102, name: 'Cerrillos (RM)' },
  { code: 13105, name: 'Conchalí (RM)' },
  { code: 13107, name: 'Estación Central (RM)' },
  { code: 13110, name: 'La Cisterna (RM)' },
  { code: 13111, name: 'La Florida (RM)' },
  { code: 13114, name: 'Las Condes (RM)' },
  { code: 13115, name: 'Lo Barnechea (RM)' },
  { code: 13119, name: 'Macul (RM)' },
  { code: 13120, name: 'Maipú (RM)' },
  { code: 13123, name: 'Ñuñoa (RM)' },
  { code: 13125, name: 'Peñalolén (RM)' },
  { code: 13126, name: 'Providencia (RM)' },
  { code: 13128, name: 'Quilicura (RM)' },
  { code: 13131, name: 'San Bernardo (RM)' },
  { code: 13132, name: 'San Joaquín (RM)' },
  { code: 13133, name: 'San Miguel (RM)' },
  { code: 13201, name: 'Puente Alto (RM)' },
  // Capitales regionales
  { code: 1101, name: 'Iquique (Tarapacá)' },
  { code: 2101, name: 'Antofagasta (Antofagasta)' },
  { code: 3101, name: 'Copiapó (Atacama)' },
  { code: 4101, name: 'La Serena (Coquimbo)' },
  { code: 5109, name: 'Valparaíso (Valparaíso)' },
  { code: 6101, name: 'Rancagua (O\'Higgins)' },
  { code: 7101, name: 'Talca (Maule)' },
  { code: 8101, name: 'Concepción (Biobío)' },
  { code: 9112, name: 'Temuco (La Araucanía)' },
  { code: 10101, name: 'Puerto Montt (Los Lagos)' },
  { code: 11101, name: 'Coyhaique (Aysén)' },
  { code: 12101, name: 'Punta Arenas (Magallanes)' },
  { code: 14101, name: 'Valdivia (Los Ríos)' },
  { code: 15101, name: 'Arica (Arica y Parinacota)' },
  { code: 16101, name: 'Chillán (Ñuble)' },
];

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function getFormNumber(formData: FormData, key: string): number | null {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.length === 0) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function CompanyClFiscalCard() {
  const { t } = useTranslation(['fiscal', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  // El `countryCode` del tenant lo leemos del resolver de locale
  // (ENG-017). Cuando el tenant es CL renderizamos el form;
  // cuando es CO/MX no renderizamos nada (CompanyPage hace el
  // dispatch).
  const localeQuery = trpc.tenantLocale.get.useQuery();
  const tenantCountry = localeQuery.data?.countryCode ?? 'CO';

  const settingsQuery = trpc.fiscalSettings.getByCountry.useQuery(
    { countryCode: 'CL' },
    { enabled: tenantCountry === 'CL' }
  );

  // ENG-036b — Read-only CAF state for the active boleta (TipoDTE 39)
  // range. The admin tab surfaces the available folio cursor so the
  // operator can plan ahead before a CAF runs out. CAF upload UI lands
  // with ENG-036c; for now operators register CAFs via SQL or dev-seed.
  const cafQuery = trpc.fiscalSettings.getActiveCaf.useQuery(
    { countryCode: 'CL', tipoDte: '39' },
    { enabled: tenantCountry === 'CL' }
  );

  const clSettings =
    settingsQuery.data?.countryCode === 'CL' ? settingsQuery.data.settings : null;

  // Fiscal "sin configurar" = no hay ningún dato significativo capturado
  // todavía (pack apagado y todos los campos vacíos). El `environment`
  // siempre trae un default ('certificacion') así que no cuenta como
  // configuración. En ese estado mostramos un EmptyState con un CTA
  // "Configurar" en vez de un form vacío; con datos existentes el form
  // se renderiza directo como antes. (El bloque CAF de abajo es
  // independiente y se muestra siempre.)
  const isConfigured = Boolean(
    clSettings &&
      (clSettings.enabled ||
        clSettings.rut ||
        clSettings.giroCode ||
        clSettings.comunaCode !== null ||
        clSettings.casaMatriz)
  );
  const [revealed, setRevealed] = useState(false);
  const showForm = isConfigured || revealed;

  const formKey = clSettings
    ? [
        clSettings.enabled,
        clSettings.rut ?? '',
        clSettings.giroCode ?? '',
        clSettings.comunaCode ?? '',
        clSettings.casaMatriz ?? '',
        clSettings.environment,
      ].join('|')
    : 'empty';

  const updateMutation = trpc.fiscalSettings.updateCl.useMutation({
    onSuccess: async () => {
      toast.success({ title: t('fiscal:settings.cl.toast.saved') });
      await utils.fiscalSettings.getByCountry.invalidate({
        countryCode: 'CL',
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'fiscal:settings.cl.toast.saveError',
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
    const nextRut = getFormString(formData, 'rut').trim();
    const nextGiroCode = getFormString(formData, 'giroCode');
    const nextComunaCode = getFormNumber(formData, 'comunaCode');
    const nextCasaMatriz = getFormString(formData, 'casaMatriz').trim();

    await updateMutation.mutateAsync({
      enabled: formData.get('enabled') === 'on',
      rut: nextRut.length > 0 ? nextRut : null,
      giroCode: nextGiroCode.length > 0 ? nextGiroCode : null,
      comunaCode: nextComunaCode,
      casaMatriz: nextCasaMatriz.length > 0 ? nextCasaMatriz : null,
      environment:
        nextEnvironment === 'produccion' ? 'produccion' : 'certificacion',
    });
  };

  // Defensive: cuando el tenant no es CL, no renderizamos nada
  // (CompanyPage es responsable del dispatch). Esta guarda existe
  // por si alguien reutiliza el componente fuera del tab.
  if (tenantCountry !== 'CL') {
    return null;
  }

  // Render principal: tenant CL. Form + readiness badge.
  return (
    <section className="card space-y-6 p-6">
      <div className="flex items-center gap-3">
        <span className="glyph-tile glyph-tile-primary h-11 w-11">
          <FileSignature className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <div className="pv-kicker">{t('fiscal:settings.cl.kicker')}</div>
          <h2 className="pv-title text-lg">{t('fiscal:settings.cl.title')}</h2>
        </div>
      </div>

      {/* Badge de readiness */}
      {validation && (
        <div
          className="space-y-3"
          aria-live="polite"
          data-testid="fiscal-cl-readiness"
        >
          <span className={cn('pv-badge', isReady ? 'success' : 'danger')}>
            {isReady ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {isReady
              ? t('fiscal:settings.readiness.ready')
              : t('fiscal:settings.readiness.notReady')}
          </span>
          {/* ENG-185 — DTE emission is an unsigned draft today (optional). */}
          {settingsQuery.data?.maturity && (
            <FiscalMaturityBadge maturity={settingsQuery.data.maturity} className="ml-2" />
          )}
          {!isReady && issueLabels.length > 0 && (
            <div className="surface-panel-muted">
              {issueLabels.map((issue, idx) => (
                <div key={`${issue.code}-${idx}`} className="pv-check">
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
        <div data-testid="fiscal-cl-empty">
          <EmptyState
            icon={FileSignature}
            title={t('fiscal:settings.cl.emptyTitle')}
            description={t('fiscal:settings.cl.emptyDescription')}
            className="px-6 py-8"
            action={
              <button
                type="button"
                className="pv-btn primary"
                data-testid="fiscal-cl-configure"
                onClick={() => setRevealed(true)}
              >
                {t('fiscal:settings.cl.emptyCta')}
              </button>
            }
          />
        </div>
      ) : (
        <form key={formKey} onSubmit={handleSubmit} className="space-y-5">
        <label className="flex items-center gap-3 text-sm font-medium text-secondary-800">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={clSettings?.enabled ?? false}
            className="h-4 w-4 shrink-0 rounded border-line-strong text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-400"
            aria-label={t('fiscal:settings.cl.fields.enabled')}
          />
          <span className="flex flex-col gap-0.5">
            <span>{t('fiscal:settings.cl.fields.enabled')}</span>
            <span className="text-xs font-normal text-secondary-500">
              {t('fiscal:settings.cl.fields.enabledHelp')}
            </span>
          </span>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <SimpleFormField
            label={t('fiscal:settings.cl.fields.rut')}
            htmlFor="fiscal-cl-rut"
            helperText={t('fiscal:settings.cl.fields.rutHelp')}
          >
            <input
              id="fiscal-cl-rut"
              name="rut"
              type="text"
              defaultValue={clSettings?.rut ?? ''}
              placeholder={t('fiscal:settings.cl.fields.rutPlaceholder')}
              className="pv-input"
              maxLength={15}
            />
          </SimpleFormField>

          <SimpleFormField
            label={t('fiscal:settings.cl.fields.giro')}
            htmlFor="fiscal-cl-giro"
          >
            <select
              id="fiscal-cl-giro"
              name="giroCode"
              defaultValue={clSettings?.giroCode ?? ''}
              className="pv-input"
            >
              <option value="">
                {t('fiscal:settings.cl.fields.giroPlaceholder')}
              </option>
              {GIRO_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code}>
                  {opt.name}
                </option>
              ))}
            </select>
          </SimpleFormField>

          <SimpleFormField
            label={t('fiscal:settings.cl.fields.comuna')}
            htmlFor="fiscal-cl-comuna"
          >
            <select
              id="fiscal-cl-comuna"
              name="comunaCode"
              defaultValue={clSettings?.comunaCode ?? ''}
              className="pv-input"
            >
              <option value="">
                {t('fiscal:settings.cl.fields.comunaPlaceholder')}
              </option>
              {COMUNA_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code}>
                  {opt.name}
                </option>
              ))}
            </select>
          </SimpleFormField>

          <SimpleFormField
            label={t('fiscal:settings.cl.fields.casaMatriz')}
            htmlFor="fiscal-cl-casa-matriz"
          >
            <input
              id="fiscal-cl-casa-matriz"
              name="casaMatriz"
              type="text"
              defaultValue={clSettings?.casaMatriz ?? ''}
              placeholder={t('fiscal:settings.cl.fields.casaMatrizPlaceholder')}
              className="pv-input"
              maxLength={200}
            />
          </SimpleFormField>

          <SimpleFormField
            label={t('fiscal:settings.cl.fields.environment')}
            htmlFor="fiscal-cl-environment"
          >
            <select
              id="fiscal-cl-environment"
              name="environment"
              defaultValue={clSettings?.environment ?? 'certificacion'}
              className="pv-input"
            >
              <option value="certificacion">
                {t('fiscal:settings.cl.fields.environmentCertificacion')}
              </option>
              <option value="produccion">
                {t('fiscal:settings.cl.fields.environmentProduccion')}
              </option>
            </select>
          </SimpleFormField>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="pv-btn primary"
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending
              ? t('fiscal:settings.cl.actions.saving')
              : t('fiscal:settings.cl.actions.save')}
          </button>
        </div>
      </form>
      )}

      {/* ENG-036b — CAF readiness indicator (read-only). */}
      <section className="surface-panel space-y-3" data-testid="cl-caf-section">
        <div>
          <div className="pv-kicker">{t('fiscal:settings.cl.caf.kicker')}</div>
          <h3 className="text-sm font-semibold text-secondary-900">
            {t('fiscal:settings.cl.caf.title')}
          </h3>
          <p className="mt-1 text-xs text-secondary-500">
            {t('fiscal:settings.cl.caf.description')}
          </p>
        </div>
        {cafQuery.data?.caf ? (
          <dl
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            data-testid="cl-caf-active"
          >
            <div>
              <dt className="pv-kicker">
                {t('fiscal:settings.cl.caf.tipoDteLabel')}
              </dt>
              <dd className="mt-1 font-mono text-sm tabular-nums text-secondary-900">
                {cafQuery.data.caf.tipoDte}
              </dd>
            </div>
            <div>
              <dt className="pv-kicker">
                {t('fiscal:settings.cl.caf.rangeLabel')}
              </dt>
              <dd className="mt-1 font-mono text-sm tabular-nums text-secondary-900">
                {t('fiscal:settings.cl.caf.range', {
                  from: cafQuery.data.caf.folioDesde,
                  to: cafQuery.data.caf.folioHasta,
                })}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <span className="pv-badge primary">
                {t('fiscal:settings.cl.caf.remaining', {
                  count: cafQuery.data.caf.rangeRemaining,
                })}
              </span>
            </div>
          </dl>
        ) : (
          <div data-testid="cl-caf-empty">
            <EmptyState
              icon={Landmark}
              title={t('fiscal:settings.cl.caf.emptyTitle')}
              description={t('fiscal:settings.cl.caf.empty')}
              className="px-6 py-8"
            />
          </div>
        )}
      </section>
    </section>
  );
}
