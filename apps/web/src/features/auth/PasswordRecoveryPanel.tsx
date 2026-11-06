import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { vanillaClient } from '@/lib/trpc';
import { ensureApiBootstrap } from '@/lib/apiBootstrap';
import { translateServerError } from '@/lib/translateServerError';
import { localOwnerRecovery } from './nativeAuthTransport';
import { getPasswordRequirementMessage, type PasswordRequirementKey } from './passwordPolicy';

type RecoveryMode = 'checking' | 'local' | 'code';

interface RecoveryFormValues {
  email: string;
  recoveryCode: string;
  newPassword: string;
  confirmPassword: string;
}

interface PasswordRecoveryPanelProps {
  initialEmail: string;
  onBack: () => void;
  onRecovered: (email: string) => void;
}

function codeError(errorCode: string): Error {
  return Object.assign(new Error(errorCode), { data: { errorCode } });
}

export function PasswordRecoveryPanel({
  initialEmail,
  onBack,
  onRecovered,
}: PasswordRecoveryPanelProps) {
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const [mode, setMode] = useState<RecoveryMode>(() =>
    localOwnerRecovery() ? 'checking' : 'code'
  );
  const [error, setError] = useState<unknown>(null);
  const form = useForm<RecoveryFormValues>({
    defaultValues: { email: initialEmail, recoveryCode: '', newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const translatePasswordRequirement = (key: PasswordRequirementKey) =>
    t(`common:passwordPolicy.${key}`);

  useEffect(() => {
    const bridge = localOwnerRecovery();
    if (!bridge) return;
    let cancelled = false;
    bridge.status().then(
      status => !cancelled && setMode(status.available ? 'local' : 'code'),
      () => !cancelled && setMode('code')
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = form.handleSubmit(async values => {
    setError(null);
    try {
      if (mode === 'local') {
        const result = await localOwnerRecovery()!.recover({
          email: values.email,
          newPassword: values.newPassword,
        });
        if (!result.ok) throw codeError(result.errorCode);
      } else {
        await ensureApiBootstrap();
        await vanillaClient.auth.recoverWithCode.mutate({
          email: values.email,
          recoveryCode: values.recoveryCode,
          newPassword: values.newPassword,
        });
      }
      onRecovered(values.email.trim());
    } catch (caught) {
      setError(caught);
    }
  });

  if (mode === 'checking') {
    return (
      <p role="status" className="mt-8 text-sm text-fg2">
        {t('passwordRecovery.checking')}
      </p>
    );
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={onSubmit} noValidate>
      <p className="text-sm leading-6 text-fg2">
        {t(
          mode === 'local'
            ? 'passwordRecovery.localDescription'
            : 'passwordRecovery.codeDescription'
        )}
      </p>

      {error !== null && (
        <div
          role="alert"
          className="rounded-[11px] border border-danger-500/20 bg-danger-50 px-4 py-3 text-sm text-danger-700"
        >
          {translateServerError(error, t, t('passwordRecovery.error'))}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="recovery-email" className="label">
          {t('login.emailLabel')}
        </label>
        <input
          id="recovery-email"
          type="email"
          autoComplete="email"
          className="input"
          {...form.register('email', { required: t('login.emailRequired') })}
        />
        {errors.email && <p className="text-sm text-danger-600">{errors.email.message}</p>}
      </div>

      {mode === 'code' && (
        <div className="space-y-2">
          <label htmlFor="recovery-code" className="label">
            {t('passwordRecovery.codeLabel')}
          </label>
          <input
            id="recovery-code"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            className="input font-mono tracking-wider"
            placeholder={t('passwordRecovery.codePlaceholder')}
            {...form.register('recoveryCode', { required: t('passwordRecovery.codeRequired') })}
          />
          {errors.recoveryCode && (
            <p className="text-sm text-danger-600">{errors.recoveryCode.message}</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="recovery-new-password" className="label">
          {t('changePassword.newPassword')}
        </label>
        <input
          id="recovery-new-password"
          type="password"
          autoComplete="new-password"
          className="input"
          {...form.register('newPassword', {
            required: t('changePassword.newRequired'),
            validate: value =>
              getPasswordRequirementMessage(value, translatePasswordRequirement) ?? true,
          })}
        />
        <p className="text-xs text-fg2">{t('changePassword.requirements')}</p>
        {errors.newPassword && (
          <p className="text-sm text-danger-600">{errors.newPassword.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="recovery-confirm-password" className="label">
          {t('changePassword.confirmPassword')}
        </label>
        <input
          id="recovery-confirm-password"
          type="password"
          autoComplete="new-password"
          className="input"
          {...form.register('confirmPassword', {
            required: t('changePassword.confirmRequired'),
            validate: value =>
              value === form.getValues('newPassword') || t('changePassword.passwordMismatch'),
          })}
        />
        {errors.confirmPassword && (
          <p className="text-sm text-danger-600">{errors.confirmPassword.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn-primary h-12 w-full justify-center"
      >
        <KeyRound className="h-4 w-4" />
        {isSubmitting ? t('passwordRecovery.submitting') : t('passwordRecovery.submit')}
      </button>

      {mode === 'code' && <p className="text-sm text-fg2">{t('passwordRecovery.noCode')}</p>}

      <button
        type="button"
        onClick={onBack}
        className="btn-ghost w-full justify-center"
        disabled={isSubmitting}
      >
        <ArrowLeft className="h-4 w-4" />
        {t('passwordRecovery.back')}
      </button>
    </form>
  );
}
