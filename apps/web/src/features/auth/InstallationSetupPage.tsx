import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ShieldCheck, Store } from 'lucide-react';
import { VERTICAL_PRESET_IDS, type VerticalPresetId } from '@puntovivo/shared/vertical-presets';
import { BrandMark } from '@/components/brand/BrandMark';
import { vanillaClient } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useAuth } from './AuthProvider';
import { getPasswordRequirementMessage } from './passwordPolicy';

/** Transient two-step form data; credentials are cleared after a successful or closed claim. */
interface SetupValues {
  businessName: string;
  siteName: string;
  countryCode: string;
  presetId: VerticalPresetId;
  ownerName: string;
  email: string;
  password: string;
  confirmPassword: string;
  token: string;
}
/** Public catalog choice; currency is derived by the server, not selected independently. */
interface SetupCountry {
  code: string;
  nameEn: string;
  nameEs: string;
  currencyCode: string;
}
/** Public choices and explicit recovery to ordinary sign-in; no native capability is accepted. */
interface InstallationSetupPageProps {
  countries: SetupCountry[];
  onSignIn: () => void;
}

/** A first-use owner is not a fiscal configuration, an opening balance, or permission to sell. */
export function InstallationSetupPage({ countries, onSignIn }: InstallationSetupPageProps) {
  const { t, i18n } = useTranslation(['installation', 'auth', 'common', 'modules', 'errors']);
  const { login } = useAuth();
  const [step, setStep] = useState<0 | 1>(0);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'created' | 'closed' | null>(null);
  const submitting = useRef(false);
  const nativeClaim = window.api?.session?.completeSetup;
  const form = useForm<SetupValues>({
    defaultValues: {
      businessName: '',
      siteName: '',
      countryCode: '',
      presetId: 'retail',
      ownerName: '',
      email: '',
      password: '',
      confirmPassword: '',
      token: '',
    },
  });
  const {
    register,
    formState: { errors, isSubmitting, isReady },
    setFocus,
  } = form;
  useEffect(() => {
    if (isReady) setFocus(step === 0 ? 'businessName' : 'ownerName');
  }, [step, setFocus, isReady]);

  const textField = (name: 'businessName' | 'siteName' | 'ownerName') => (
    <div className="space-y-2" key={name}>
      <label className="label" htmlFor={`setup-${name}`}>
        {t(`setup.${name}`)}
      </label>
      <input
        id={`setup-${name}`}
        className="input"
        maxLength={120}
        autoComplete={
          name === 'ownerName' ? 'name' : name === 'businessName' ? 'organization' : 'off'
        }
        aria-invalid={Boolean(errors[name])}
        aria-describedby={errors[name] ? `setup-${name}-error` : undefined}
        {...register(name, { validate: value => value.trim().length > 0 || t('setup.required') })}
      />
      {errors[name] && (
        <p id={`setup-${name}-error`} className="text-sm text-danger-700">
          {errors[name].message}
        </p>
      )}
    </div>
  );

  const next = async () => {
    if (
      await form.trigger(['businessName', 'siteName', 'countryCode', 'presetId'], {
        shouldFocus: true,
      })
    )
      setStep(1);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    await form.handleSubmit(async values => {
      if (submitting.current) return;
      submitting.current = true;
      setError(null);
      const { token } = values;
      const fields = {
        businessName: values.businessName,
        siteName: values.siteName,
        countryCode: values.countryCode,
        presetId: values.presetId,
        ownerName: values.ownerName,
        email: values.email,
        password: values.password,
      };
      try {
        if (nativeClaim) {
          const result = await nativeClaim(fields);
          if (!result.ok) throw { data: { errorCode: result.errorCode } };
        } else {
          await vanillaClient.auth.completeSetup.mutate({ ...fields, token: token.trim() });
        }
        // A successful claim must never be repeated if normal login fails or its
        // response is lost. Existing credentials are the only recovery path.
        form.reset({ ...values, password: '', confirmPassword: '', token: '' });
        setOutcome('created');
        try {
          await login({ email: values.email.trim().toLowerCase(), password: values.password });
        } catch {
          /* Keep an explicit sign-in recovery action, never retry the claim. */
        }
      } catch (failure) {
        const code = (failure as { data?: { errorCode?: string } })?.data?.errorCode;
        if (code === 'SETUP_ALREADY_COMPLETED') {
          form.reset({ ...values, password: '', confirmPassword: '', token: '' });
          setOutcome('closed');
        } else {
          setError(translateServerError(failure, t, t('setup.failed')));
        }
      } finally {
        submitting.current = false;
      }
    })(event);
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center gap-3">
          <BrandMark className="h-10 w-10" label="Puntovivo" />
          <div>
            <p className="page-kicker">Puntovivo</p>
            <p className="text-sm text-fg2">{t('setup.kicker')}</p>
          </div>
        </header>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="space-y-5 lg:pt-6">
            <h1 className="font-display text-4xl leading-tight text-secondary-950 sm:text-5xl">
              {t('setup.title')}
            </h1>
            <p className="max-w-md leading-7 text-fg2">{t('setup.description')}</p>
            <ol className="flex gap-6 lg:flex-col" aria-label={t('setup.progress')}>
              {([0, 1] as const).map(index => (
                <li
                  key={index}
                  aria-current={!outcome && step === index ? 'step' : undefined}
                  className={`flex items-center gap-3 text-sm ${step === index ? 'font-semibold text-secondary-950' : 'text-fg2'}`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${step >= index ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-line'}`}
                  >
                    {step > index || outcome === 'created' ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {t(index === 0 ? 'setup.businessStep' : 'setup.ownerStep')}
                </li>
              ))}
            </ol>
            <div className="flex gap-3 rounded-xl border border-line bg-surface2 p-4 text-sm leading-6 text-fg2">
              <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
              <p>{t('setup.readinessNote')}</p>
            </div>
          </section>
          <section className="shell-panel p-6 sm:p-8" aria-busy={isSubmitting}>
            {outcome ? (
              <div className="space-y-5" role="status">
                <h2 className="font-display text-2xl">
                  {t(outcome === 'created' ? 'setup.created' : 'setup.closed')}
                </h2>
                <p className="text-fg2">
                  {t(outcome === 'created' ? 'setup.signInRecovery' : 'setup.closedRecovery')}
                </p>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={onSignIn}
                  disabled={isSubmitting}
                >
                  {t('setup.signIn')}
                </button>
              </div>
            ) : (
              <form
                onSubmit={
                  step === 0
                    ? event => {
                        event.preventDefault();
                        void next();
                      }
                    : submit
                }
                noValidate
                className="space-y-5"
              >
                <h2 className="flex items-center gap-2 font-display text-2xl">
                  <Store className="h-5 w-5 text-primary-600" aria-hidden="true" />
                  {t(step === 0 ? 'setup.businessStep' : 'setup.ownerStep')}
                </h2>
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-danger-500/20 bg-danger-50 p-3 text-sm text-danger-700"
                  >
                    {error}
                  </p>
                )}
                {step === 0 ? (
                  <>
                    {textField('businessName')}
                    {textField('siteName')}
                    <div className="space-y-2">
                      <label className="label" htmlFor="setup-countryCode">
                        {t('setup.countryCode')}
                      </label>
                      <select
                        id="setup-countryCode"
                        className="input"
                        aria-invalid={Boolean(errors.countryCode)}
                        aria-describedby="setup-country-help"
                        {...register('countryCode', { required: t('setup.required') })}
                      >
                        <option value="">{t('setup.chooseCountry')}</option>
                        {countries.map(country => (
                          <option key={country.code} value={country.code}>
                            {i18n.language.startsWith('es') ? country.nameEs : country.nameEn} ·{' '}
                            {country.currencyCode}
                          </option>
                        ))}
                      </select>
                      <p id="setup-country-help" className="text-xs text-fg2">
                        {t('setup.countryHelp')}
                      </p>
                      {errors.countryCode && (
                        <p className="text-sm text-danger-700">{errors.countryCode.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="label" htmlFor="setup-presetId">
                        {t('setup.presetId')}
                      </label>
                      <select id="setup-presetId" className="input" {...register('presetId')}>
                        {VERTICAL_PRESET_IDS.map(id => (
                          <option key={id} value={id}>
                            {t(`modules:presets.verticals.${id}`)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-fg2">{t('setup.presetHelp')}</p>
                    </div>
                  </>
                ) : (
                  <>
                    {textField('ownerName')}
                    <div className="space-y-2">
                      <label className="label" htmlFor="setup-email">
                        {t('auth:login.emailLabel')}
                      </label>
                      <input
                        id="setup-email"
                        type="email"
                        className="input"
                        autoComplete="email"
                        maxLength={254}
                        aria-invalid={Boolean(errors.email)}
                        aria-describedby={errors.email ? 'setup-email-error' : undefined}
                        {...register('email', {
                          required: t('setup.required'),
                          pattern: {
                            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                            message: t('auth:login.emailInvalid'),
                          },
                        })}
                      />
                      {errors.email && (
                        <p id="setup-email-error" className="text-sm text-danger-700">
                          {errors.email.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="label" htmlFor="setup-password">
                        {t('auth:login.passwordLabel')}
                      </label>
                      <div className="relative">
                        <input
                          id="setup-password"
                          type={showPassword ? 'text' : 'password'}
                          className="input pr-12"
                          autoComplete="new-password"
                          maxLength={128}
                          aria-invalid={Boolean(errors.password)}
                          aria-describedby="setup-password-help setup-password-error"
                          {...register('password', {
                            validate: value =>
                              getPasswordRequirementMessage(value, key =>
                                t(`common:passwordPolicy.${key}`)
                              ) ?? true,
                          })}
                        />
                        <button
                          type="button"
                          className="btn-ghost btn-icon absolute right-1 top-1/2 -translate-y-1/2"
                          onClick={() => setShowPassword(value => !value)}
                          aria-label={t(
                            showPassword ? 'auth:login.hidePassword' : 'auth:login.showPassword'
                          )}
                          aria-pressed={showPassword}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <p id="setup-password-help" className="text-xs text-fg2">
                        {t('setup.passwordHelp')}
                      </p>
                      <p id="setup-password-error" className="text-sm text-danger-700">
                        {errors.password?.message}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="label" htmlFor="setup-confirmPassword">
                        {t('setup.confirmPassword')}
                      </label>
                      <input
                        id="setup-confirmPassword"
                        type="password"
                        className="input"
                        autoComplete="new-password"
                        maxLength={128}
                        aria-invalid={Boolean(errors.confirmPassword)}
                        aria-describedby={
                          errors.confirmPassword ? 'setup-confirm-error' : undefined
                        }
                        {...register('confirmPassword', {
                          validate: value =>
                            value === form.getValues('password') || t('setup.passwordMismatch'),
                        })}
                      />
                      {errors.confirmPassword && (
                        <p id="setup-confirm-error" className="text-sm text-danger-700">
                          {errors.confirmPassword.message}
                        </p>
                      )}
                    </div>
                    {!nativeClaim && (
                      <div className="space-y-2 rounded-xl border border-line p-4">
                        <label className="label" htmlFor="setup-token">
                          {t('setup.token')}
                        </label>
                        <input
                          id="setup-token"
                          className="input font-mono"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={Boolean(errors.token)}
                          aria-describedby="setup-token-help setup-token-error"
                          {...register('token', {
                            validate: value =>
                              /^[a-f0-9]{64}$/i.test(value.trim()) || t('setup.tokenInvalid'),
                          })}
                        />
                        <p id="setup-token-help" className="text-xs leading-5 text-fg2">
                          {t('setup.tokenHelp')}
                        </p>
                        <p id="setup-token-error" className="text-sm text-danger-700">
                          {errors.token?.message}
                        </p>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center justify-between gap-3 border-t border-line pt-5">
                  {step === 1 && (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={isSubmitting}
                      onClick={() => setStep(0)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      {t('setup.back')}
                    </button>
                  )}
                  <button
                    type="submit"
                    className="btn-primary ml-auto min-h-12"
                    disabled={isSubmitting}
                  >
                    {t(
                      step === 0 ? 'setup.next' : isSubmitting ? 'setup.creating' : 'setup.submit'
                    )}
                    {!isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
