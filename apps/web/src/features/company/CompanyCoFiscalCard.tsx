/**
 * ENG-184 — Admin card for the Colombia (DIAN) fiscal config.
 *
 * Lives in the `Fiscal` tab of `CompanyPage`, replacing the old
 * "coming soon" placeholder. Reads `fiscalSettings.getByCountry({CO})`,
 * writes via `fiscalSettings.updateCo`, and shows a PRESENCE readiness
 * badge (NIT / resolution / numbering range captured?).
 *
 * DIAN is OPTIONAL: a merchant can keep selling without it. This card
 * captures the issuer config so they are "ready to activate" whenever
 * they choose. Real CUFE signing + provider transmission stay mock /
 * gated behind ENG-021 — this card only captures + probes presence.
 *
 * Mirrors the structure of `CompanyMxFiscalCard` (uncontrolled FormData
 * + tRPC + readiness badge + EmptyState/reveal). When the tenant is not
 * Colombia the card renders nothing (CompanyPage already dispatches by
 * country; the guard is defensive).
 */
import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSignature } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Parse a positive-integer form field; empty / invalid → null (clears it). */
function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function CompanyCoFiscalCard() {
  const { t } = useTranslation(['fiscal', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const localeQuery = trpc.tenantLocale.get.useQuery();
  const tenantCountry = localeQuery.data?.countryCode ?? 'CO';

  const settingsQuery = trpc.fiscalSettings.getByCountry.useQuery(
    { countryCode: 'CO' },
    { enabled: tenantCountry === 'CO' }
  );

  const coSettings =
    settingsQuery.data?.countryCode === 'CO' ? settingsQuery.data.settings : null;

  // "Sin configurar" = no significant field captured yet (DIAN off and
  // every issuer field empty). In that state we show an EmptyState with
  // a "Configure" CTA instead of a blank form; with data we render the
  // form directly.
  const isConfigured = Boolean(
    coSettings &&
      (coSettings.enabled ||
        coSettings.nit ||
        coSettings.dianResolutionNumber ||
        coSettings.prefix ||
        coSettings.rangeFrom !== null ||
        coSettings.rangeTo !== null)
  );
  const [revealed, setRevealed] = useState(false);
  const showForm = isConfigured || revealed;

  const formKey = coSettings
    ? [
        coSettings.enabled,
        coSettings.nit ?? '',
        coSettings.dianResolutionNumber ?? '',
        coSettings.prefix ?? '',
        coSettings.rangeFrom ?? '',
        coSettings.rangeTo ?? '',
        coSettings.environment,
      ].join('|')
    : 'empty';

  const updateMutation = trpc.fiscalSettings.updateCo.useMutation({
    onSuccess: async () => {
      toast.success({ title: t('fiscal:settings.co.toast.saved') });
      await Promise.all([
        utils.fiscalSettings.getByCountry.invalidate({ countryCode: 'CO' }),
        utils.setupReadiness.get.invalidate(),
        utils.setupReadiness.checkout.invalidate(),
      ]);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'fiscal:settings.co.toast.saveError',
    }),
  });

  const validation = settingsQuery.data?.validation;
  const isReady = validation?.ok ?? false;

  const issueLabels = useMemo(() => {
    if (!validation) return [];
    return validation.issues.map(issue => ({
      code: issue.code,
      label: t(`fiscal:settings.co.issueCodes.${issue.code}`, {
        defaultValue: issue.message,
      }),
    }));
  }, [validation, t]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextNit = getFormString(formData, 'nit').trim();
    const nextResolution = getFormString(
      formData,
      'dianResolutionNumber'
    ).trim();
    const nextPrefix = getFormString(formData, 'prefix').trim();
    const nextRangeFrom = parsePositiveInt(getFormString(formData, 'rangeFrom'));
    const nextRangeTo = parsePositiveInt(getFormString(formData, 'rangeTo'));
    const nextEnvironment = getFormString(formData, 'environment');

    await updateMutation.mutateAsync({
      enabled: formData.get('enabled') === 'on',
      nit: nextNit.length > 0 ? nextNit : null,
      dianResolutionNumber: nextResolution.length > 0 ? nextResolution : null,
      prefix: nextPrefix.length > 0 ? nextPrefix : null,
      rangeFrom: nextRangeFrom,
      rangeTo: nextRangeTo,
      environment:
        nextEnvironment === 'produccion' ? 'produccion' : 'habilitacion',
    });
  };

  // Defensive: CompanyPage dispatches by country, but guard anyway so the
  // card is inert if reused elsewhere with a non-CO tenant.
  if (tenantCountry !== 'CO') {
    return null;
  }

  return (
    <section className="card space-y-6 p-6">
      <div className="flex items-center gap-3">
        <span className="glyph-tile glyph-tile-primary h-11 w-11">
          <FileSignature className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <div className="pv-kicker">{t('fiscal:settings.co.kicker')}</div>
          <h2 className="pv-title text-lg">{t('fiscal:settings.co.title')}</h2>
        </div>
      </div>

      {validation && (
        <div
          className="space-y-3"
          aria-live="polite"
          data-testid="fiscal-co-readiness"
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
        <div data-testid="fiscal-co-empty">
          <EmptyState
            icon={FileSignature}
            title={t('fiscal:settings.co.emptyTitle')}
            description={t('fiscal:settings.co.emptyDescription')}
            className="px-6 py-8"
            action={
              <button
                type="button"
                className="pv-btn primary"
                data-testid="fiscal-co-configure"
                onClick={() => setRevealed(true)}
              >
                {t('fiscal:settings.co.emptyCta')}
              </button>
            }
          />
        </div>
      ) : (
        <form key={formKey} onSubmit={handleSubmit} className="space-y-5">
          <label className="flex items-center gap-3 text-sm font-medium text-secondary-800">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={coSettings?.enabled ?? false}
              className="h-4 w-4 shrink-0 rounded border-line-strong text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-400"
              aria-label={t('fiscal:settings.co.fields.enabled')}
            />
            <span className="flex flex-col gap-0.5">
              <span>{t('fiscal:settings.co.fields.enabled')}</span>
              <span className="text-xs font-normal text-secondary-500">
                {t('fiscal:settings.co.fields.enabledHelp')}
              </span>
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <SimpleFormField
              label={t('fiscal:settings.co.fields.nit')}
              htmlFor="fiscal-co-nit"
              helperText={t('fiscal:settings.co.fields.nitHelp')}
            >
              <input
                id="fiscal-co-nit"
                name="nit"
                type="text"
                defaultValue={coSettings?.nit ?? ''}
                placeholder={t('fiscal:settings.co.fields.nitPlaceholder')}
                className="pv-input"
                maxLength={20}
              />
            </SimpleFormField>

            <SimpleFormField
              label={t('fiscal:settings.co.fields.resolution')}
              htmlFor="fiscal-co-resolution"
              helperText={t('fiscal:settings.co.fields.resolutionHelp')}
            >
              <input
                id="fiscal-co-resolution"
                name="dianResolutionNumber"
                type="text"
                defaultValue={coSettings?.dianResolutionNumber ?? ''}
                placeholder={t('fiscal:settings.co.fields.resolutionPlaceholder')}
                className="pv-input"
                maxLength={40}
              />
            </SimpleFormField>

            <SimpleFormField
              label={t('fiscal:settings.co.fields.prefix')}
              htmlFor="fiscal-co-prefix"
            >
              <input
                id="fiscal-co-prefix"
                name="prefix"
                type="text"
                defaultValue={coSettings?.prefix ?? ''}
                placeholder={t('fiscal:settings.co.fields.prefixPlaceholder')}
                className="pv-input"
                maxLength={10}
              />
            </SimpleFormField>

            <SimpleFormField
              label={t('fiscal:settings.co.fields.environment')}
              htmlFor="fiscal-co-environment"
            >
              <select
                id="fiscal-co-environment"
                name="environment"
                defaultValue={coSettings?.environment ?? 'habilitacion'}
                className="pv-input"
              >
                <option value="habilitacion">
                  {t('fiscal:settings.co.fields.environmentHabilitacion')}
                </option>
                <option value="produccion">
                  {t('fiscal:settings.co.fields.environmentProduccion')}
                </option>
              </select>
            </SimpleFormField>

            <SimpleFormField
              label={t('fiscal:settings.co.fields.rangeFrom')}
              htmlFor="fiscal-co-range-from"
            >
              <input
                id="fiscal-co-range-from"
                name="rangeFrom"
                type="number"
                min={1}
                defaultValue={coSettings?.rangeFrom ?? ''}
                placeholder={t('fiscal:settings.co.fields.rangeFromPlaceholder')}
                className="pv-input"
              />
            </SimpleFormField>

            <SimpleFormField
              label={t('fiscal:settings.co.fields.rangeTo')}
              htmlFor="fiscal-co-range-to"
            >
              <input
                id="fiscal-co-range-to"
                name="rangeTo"
                type="number"
                min={1}
                defaultValue={coSettings?.rangeTo ?? ''}
                placeholder={t('fiscal:settings.co.fields.rangeToPlaceholder')}
                className="pv-input"
              />
            </SimpleFormField>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="pv-btn primary"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending
                ? t('fiscal:settings.co.actions.saving')
                : t('fiscal:settings.co.actions.save')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
