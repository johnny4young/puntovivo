/**
 * slice 2 — admin card for payment provider credentials.
 *
 * Renders a credential vault: one collapsible accordion section per
 * payment rail (§12 redesign). Each section shows:
 * - a glyph tile + the rail name and a one-line description,
 * - a readiness chip (configured / missing credentials) driven by the
 * server-side `validateConfig` result,
 * - one form field per descriptor declared in
 * `services/payments/manifest.ts::CREDENTIAL_FIELDS_BY_RAIL`,
 * - a single "Save" button per rail, anchored to the right, that calls
 * `paymentSettings.updateRail` and re-paints the section with the
 * fresh masked credentials + readiness.
 *
 * Sensitive fields render as password inputs and display a "Show /
 * Hide" toggle so the operator can confirm the value they pasted.
 * After save the server returns masked values; the field input goes
 * back to blank with a stored-hint label so re-entry overwrites the
 * stored value. Where no value is stored the field is shown honestly
 * empty — never masked with dots that contradict the empty state.
 *
 * The accordion expands one section at a time. Every section body
 * stays mounted in the DOM and is toggled with the `hidden` attribute
 * so the read-side stays addressable; visual collapse is driven by the
 * `.pv-acc.open` recipe.
 *
 * Mirror-structural with `CompanyMxFiscalCard` () — same
 * glyph header + readiness chip + save CTA vocabulary. Lives inside
 * the `payments` tab on `CompanyPage`.
 *
 * @module features/company/CompanyPaymentsCard
 */

import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  CreditCard,
  Eye,
  EyeOff,
  Save,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
type PaymentSettingsResponse = inferRouterOutputs<AppRouter>['paymentSettings']['getAll'];
type RailEntry = PaymentSettingsResponse['rails'][number];
type CredentialView = RailEntry['credentials'][number];

// Per-rail glyph. Falls back to a generic card for any rail the
// manifest adds later without a mapping here.
const RAIL_GLYPHS: Record<string, LucideIcon> = {
  wompi: CreditCard,
  bold: CreditCard,
  mercado_pago: CreditCard,
  nequi: Smartphone,
  daviplata: Smartphone,
  epayco: Wallet,
};
export function CompanyPaymentsCard() {
  const { t } = useTranslation(['operations', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const query = trpc.paymentSettings.getAll.useQuery();

  // Track which section is expanded. Default to the first rail that
  // still needs credentials so the operator lands on actionable work.
  const [openRailId, setOpenRailId] = useState<string | null>(null);
  const updateMutation = trpc.paymentSettings.updateRail.useMutation({
    onSuccess: async (_data, variables) => {
      toast.success({
        title: t('operations:payments.settings.form.savedToast', {
          rail: t(`operations:payments.rails.${variables.railId}`, {
            defaultValue: variables.railId,
          }),
        }),
      });
      await Promise.all([
        utils.paymentSettings.getAll.invalidate(),
        utils.setupReadiness.get.invalidate(),
        utils.setupReadiness.checkout.invalidate(),
      ]);
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
  const rails = query.data.rails;
  const firstUnconfigured = rails.find(rail => !rail.validation.ok);
  // Resolve the effective open section: explicit operator choice wins;
  // otherwise default to the first rail that needs attention.
  const effectiveOpenId = openRailId !== null ? openRailId : (firstUnconfigured?.railId ?? null);
  return (
    <div className="space-y-5" data-testid="payments-card">
      <div className="card p-6 space-y-2">
        <div className="flex items-center gap-3">
          <span className="pv-gt pv-gt-primary h-9 w-9">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="pv-title text-lg">{t('operations:payments.settings.title')}</h2>
        </div>
        <p className="text-sm text-secondary-600">
          {t('operations:payments.settings.description')}
        </p>
      </div>

      <div data-testid="payments-vault">
        {rails.map(rail => (
          <RailSection
            key={rail.railId}
            rail={rail}
            isOpen={effectiveOpenId === rail.railId}
            onToggle={() =>
              setOpenRailId(current => (current === rail.railId ? null : rail.railId))
            }
            isSaving={updateMutation.isPending && updateMutation.variables?.railId === rail.railId}
            onSubmit={async credentials => {
              await updateMutation.mutateAsync({
                railId: rail.railId,
                credentials,
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}
interface RailSectionProps {
  rail: RailEntry;
  isOpen: boolean;
  onToggle: () => void;
  isSaving: boolean;
  onSubmit: (credentials: Record<string, string>) => Promise<void>;
}
function RailSection({ rail, isOpen, onToggle, isSaving, onSubmit }: RailSectionProps) {
  const { t } = useTranslation('operations');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [touchedCredentials, setTouchedCredentials] = useState<Record<string, boolean>>({});
  const isReady = rail.validation.ok;
  const Glyph = RAIL_GLYPHS[rail.railId] ?? CreditCard;
  const bodyId = `payments-rail-${rail.railId}-body`;
  const railName = t(`payments.rails.${rail.railId}`, {
    defaultValue: rail.label,
  });
  const railDescription = t(`payments.settings.rails.${rail.railId}.description`, {
    defaultValue: '',
  });
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
    <div className={cn('pv-acc', isOpen && 'open')} data-testid={`payments-rail-${rail.railId}`}>
      <button
        type="button"
        className="pv-acc-hd w-full text-left"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={onToggle}
        data-testid={`payments-rail-${rail.railId}-toggle`}
      >
        <span className={cn('pv-gt h-[30px] w-[30px]', isOpen ? 'pv-gt-primary' : 'pv-gt-ink')}>
          <Glyph className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="nm block">{railName}</span>
          {railDescription && <span className="sub block">{railDescription}</span>}
        </span>
        <Badge
          variant={isReady ? 'success' : 'warning'}
          marker="dot"
          className="ml-auto"
          data-testid={`payments-rail-${rail.railId}-readiness`}
        >
          {isReady
            ? t('payments.settings.readiness.ready')
            : t('payments.settings.readiness.notReady')}
        </Badge>
        <ChevronDown
          className={cn('chev h-4 w-4 transition-transform', isOpen && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      <div className="pv-acc-body" id={bodyId} hidden={!isOpen}>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          {!isReady && issueLabels && issueLabels.length > 0 && (
            <p
              className="text-xs text-warning-700"
              aria-live="polite"
              data-testid={`payments-rail-${rail.railId}-missing`}
            >
              {t('payments.settings.readiness.missingFields', {
                fields: issueLabels.join(', '),
              })}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs text-secondary-500">
              <ShieldCheck className="h-3.5 w-3.5 text-success-700" aria-hidden="true" />
              {t('payments.settings.form.encryptedNote')}
            </span>
            <Button
              type="submit"
              disabled={isSaving}
              data-testid={`payments-rail-${rail.railId}-save`}
              variant="primary"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSaving ? t('payments.settings.form.saving') : t('payments.settings.form.save')}
            </Button>
          </div>
        </form>
      </div>
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
  const inputType = credential.sensitive && !revealed ? 'password' : 'text';
  // Sensitive note: the masked value (e.g. `••••••••XYZ`) MUST NOT
  // land in the input's `placeholder` attribute — placeholders are
  // copyable DOM strings reachable by extensions and select-all. Keep
  // the placeholder generic and surface the masked value only in the
  // hint paragraph below the input as plain inline text the operator
  // can read but cannot accidentally re-submit. Where nothing is
  // stored the field is honestly empty — no masking dots.
  // Honest empty placeholder. A stored field keeps a blank input
  // (re-entry overwrites) and surfaces its masked value in the hint
  // line below — never in the placeholder, which is a copyable string.
  const placeholder = t('payments.settings.form.emptyPlaceholder');
  const fieldLabel = t(`payments.settings.fields.${credential.key}`, {
    defaultValue: credential.key,
  });
  const handleClear = () => {
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.focus();
    }
    onMarkTouched();
  };
  return (
    <div className="pv-field">
      <label htmlFor={inputId} className="label">
        {fieldLabel}
      </label>
      <div className="pv-input">
        <input
          ref={inputRef}
          id={inputId}
          name={credential.key}
          type={inputType}
          className="min-w-0 flex-1 bg-transparent outline-none"
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
            className="text-secondary-400 transition-colors hover:text-secondary-700"
            onClick={onToggleReveal}
            aria-label={
              revealed
                ? t('payments.settings.form.hideSecret')
                : t('payments.settings.form.showSecret')
            }
            data-testid={`payments-${railId}-${credential.key}-reveal`}
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {credential.hasStoredValue && (
        <p className="help" data-testid={`payments-${railId}-${credential.key}-hint`}>
          {t('payments.settings.form.storedHint')}{' '}
          <span className="font-mono">{credential.value}</span>{' '}
          <button
            type="button"
            className="font-medium text-primary-700 underline-offset-2 hover:underline"
            onClick={handleClear}
            data-testid={`payments-${railId}-${credential.key}-clear`}
          >
            {t('payments.settings.form.clearField')}
          </button>
        </p>
      )}
    </div>
  );
}
