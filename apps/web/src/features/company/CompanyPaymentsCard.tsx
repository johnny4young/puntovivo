/**
 * ENG-038 slice 2 — admin card for payment provider credentials.
 *
 * Renders one accordion-style section per rail. Each section shows:
 * - a readiness badge (ready / missing credentials) driven by the
 *   server-side `validateConfig` result,
 * - a stub vs live-integration pill (today all 6 rails are stubs),
 * - one form field per descriptor declared in
 *   `services/payments/manifest.ts::CREDENTIAL_FIELDS_BY_RAIL`,
 * - a "Save credentials" button that calls
 *   `paymentSettings.updateRail` and re-paints the section with the
 *   fresh masked credentials + readiness.
 *
 * Sensitive fields render as password inputs and display a "Show /
 * Hide" toggle so the operator can confirm the value they pasted.
 * After save the server returns masked values; the field input goes
 * back to blank with a stored-hint label so re-entry overwrites the
 * stored value.
 *
 * Mirror-structural with `CompanyMxFiscalCard` (ENG-035a) — same
 * shape for the readiness badge + the "save / saving" CTA. Lives
 * inside the new `payments` tab on `CompanyPage`.
 *
 * @module features/company/CompanyPaymentsCard
 */

import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, Eye, EyeOff, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

type PaymentSettingsResponse =
  inferRouterOutputs<AppRouter>['paymentSettings']['getAll'];
type RailEntry = PaymentSettingsResponse['rails'][number];
type CredentialView = RailEntry['credentials'][number];

export function CompanyPaymentsCard() {
  const { t } = useTranslation(['operations', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const query = trpc.paymentSettings.getAll.useQuery();

  const updateMutation = trpc.paymentSettings.updateRail.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success({
        title: t('operations:payments.settings.form.savedToast', {
          rail: t(`operations:payments.rails.${variables.railId}`, {
            defaultValue: variables.railId,
          }),
        }),
      });
      await utils.paymentSettings.getAll.invalidate();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:payments.settings.form.saveErrorToast',
    }),
  });

  if (query.isLoading) {
    return (
      <div className="card p-6" data-testid="payments-card-loading">
        <p className="text-sm text-secondary-500">{t('common:actions.loading')}</p>
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="card p-6 text-sm text-danger-700" data-testid="payments-card-error">
        {t('errors:server.unknown')}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="payments-card">
      <div className="card p-6 space-y-2">
        <div className="flex items-center gap-3">
          <CreditCard className="h-6 w-6 text-primary-700" />
          <h2 className="text-lg font-semibold text-secondary-950">
            {t('operations:payments.settings.title')}
          </h2>
        </div>
        <p className="text-sm text-secondary-600">
          {t('operations:payments.settings.description')}
        </p>
      </div>

      {query.data.rails.map(rail => (
        <RailSection
          key={rail.railId}
          rail={rail}
          isSaving={
            updateMutation.isPending &&
            updateMutation.variables?.railId === rail.railId
          }
          onSubmit={async credentials => {
            await updateMutation.mutateAsync({
              railId: rail.railId,
              credentials,
            });
          }}
        />
      ))}
    </div>
  );
}

interface RailSectionProps {
  rail: RailEntry;
  isSaving: boolean;
  onSubmit: (credentials: Record<string, string>) => Promise<void>;
}

function RailSection({ rail, isSaving, onSubmit }: RailSectionProps) {
  const { t } = useTranslation('operations');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [touchedCredentials, setTouchedCredentials] = useState<
    Record<string, boolean>
  >({});

  const issueLabels = useMemo(() => {
    if (rail.validation.ok) return null;
    return rail.validation.issues
      .map(issue =>
        issue.field
          ? t(`payments.settings.fields.${issue.field}`, {
              defaultValue: issue.field,
            })
          : null
      )
      .filter((label): label is string => label !== null);
  }, [rail.validation, t]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(event.currentTarget);
    const credentials: Record<string, string> = {};
    for (const credential of rail.credentials) {
      if (!touchedCredentials[credential.key]) continue;
      const raw = formData.get(credential.key);
      const value = typeof raw === 'string' ? raw : '';
      // Only forward fields the operator actually touched. Empty
      // strings are forwarded so the server can clear a stored value.
      credentials[credential.key] = value;
    }
    await onSubmit(credentials);
    form.reset();
    setTouchedCredentials({});
    setRevealed({});
  };

  return (
    <div className="card p-6 space-y-4" data-testid={`payments-rail-${rail.railId}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-secondary-900">
            {t(`payments.rails.${rail.railId}`, { defaultValue: rail.label })}
          </h3>
          <p className="text-xs text-secondary-500 mt-1">
            {t(`payments.settings.rails.${rail.railId}.description`, {
              defaultValue: '',
            })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              rail.liveIntegration
                ? 'bg-success-50 text-success-700 border border-success-200'
                : 'bg-secondary-100 text-secondary-600 border border-secondary-200'
            }`}
            data-testid={`payments-rail-${rail.railId}-integration`}
          >
            {rail.liveIntegration
              ? t('payments.settings.liveBadge')
              : t('payments.settings.stubBadge')}
          </span>
        </div>
      </div>

      <div
        className={`rounded-xl border p-3 flex items-start gap-2 ${
          rail.validation.ok
            ? 'border-success-200 bg-success-50 text-success-700'
            : 'border-warning-200 bg-warning-50 text-warning-700'
        }`}
        aria-live="polite"
        data-testid={`payments-rail-${rail.railId}-readiness`}
      >
        {rail.validation.ok ? (
          <CheckCircle2 className="h-5 w-5 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 shrink-0" />
        )}
        <div className="text-sm">
          <p className="font-medium">
            {rail.validation.ok
              ? t('payments.settings.readiness.ready')
              : t('payments.settings.readiness.notReady')}
          </p>
          {!rail.validation.ok && issueLabels && issueLabels.length > 0 && (
            <p className="text-xs mt-1">
              {t('payments.settings.readiness.missingFields', {
                fields: issueLabels.join(', '),
              })}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {rail.credentials.map(credential => (
          <CredentialInput
            key={credential.key}
            railId={rail.railId}
            credential={credential}
            revealed={Boolean(revealed[credential.key])}
            onToggleReveal={() =>
              setRevealed(state => ({
                ...state,
                [credential.key]: !state[credential.key],
              }))
            }
            onMarkTouched={() =>
              setTouchedCredentials(state => ({
                ...state,
                [credential.key]: true,
              }))
            }
          />
        ))}
        <div className="flex justify-end">
          <button
            type="submit"
            className="btn-primary"
            disabled={isSaving}
            data-testid={`payments-rail-${rail.railId}-save`}
          >
            {isSaving
              ? t('payments.settings.form.saving')
              : t('payments.settings.form.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

interface CredentialInputProps {
  railId: string;
  credential: CredentialView;
  revealed: boolean;
  onToggleReveal: () => void;
  onMarkTouched: () => void;
}

function CredentialInput({
  railId,
  credential,
  revealed,
  onToggleReveal,
  onMarkTouched,
}: CredentialInputProps) {
  const { t } = useTranslation('operations');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = `payments-${railId}-${credential.key}`;
  const inputType =
    credential.sensitive && !revealed ? 'password' : 'text';
  // Sensitive note: the masked value (e.g. `••••••••XYZ`) MUST NOT
  // land in the input's `placeholder` attribute — placeholders are
  // copyable DOM strings reachable by extensions and select-all. Keep
  // the placeholder generic and surface the masked value only in the
  // hint paragraph below the input as plain inline text the operator
  // can read but cannot accidentally re-submit.
  const placeholder = t('payments.settings.form.emptyHint');
  const handleClear = () => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.focus();
    }
    onMarkTouched();
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-secondary-700"
      >
        {t(`payments.settings.fields.${credential.key}`, {
          defaultValue: credential.key,
        })}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          ref={inputRef}
          id={inputId}
          name={credential.key}
          type={inputType}
          className="input flex-1"
          defaultValue=""
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={onMarkTouched}
          data-testid={`payments-${railId}-${credential.key}-input`}
        />
        {credential.sensitive && (
          <button
            type="button"
            className="btn-outline px-2"
            onClick={onToggleReveal}
            aria-label={
              revealed
                ? t('payments.settings.form.hideSecret')
                : t('payments.settings.form.showSecret')
            }
            data-testid={`payments-${railId}-${credential.key}-reveal`}
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        )}
        {credential.hasStoredValue && (
          <button
            type="button"
            className="btn-outline px-2"
            onClick={handleClear}
            data-testid={`payments-${railId}-${credential.key}-clear`}
          >
            {t('payments.settings.form.clearField')}
          </button>
        )}
      </div>
      <p
        className="mt-1 text-xs text-secondary-500"
        data-testid={`payments-${railId}-${credential.key}-hint`}
      >
        {credential.hasStoredValue ? (
          <>
            {t('payments.settings.form.storedHint')}{' '}
            <span className="font-mono">{credential.value}</span>
          </>
        ) : (
          t('payments.settings.form.emptyHint')
        )}
      </p>
    </div>
  );
}
