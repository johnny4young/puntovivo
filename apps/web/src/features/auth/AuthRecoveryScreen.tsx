import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { AuthContextType } from './AuthContext';

type Props = { recovery: NonNullable<AuthContextType['bootstrapRecovery']> };

/** Eager, bootstrap-localized and usable even when lazy route chunks are offline. */
export function AuthRecoveryScreen({ recovery }: Props) {
  const { t } = useTranslation('auth');
  const [now, setNow] = useState(Date.now);
  const heading = useRef<HTMLHeadingElement>(null);
  const seconds = Math.max(0, Math.ceil((recovery.retryAt - now) / 1_000));
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (seconds === 0) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), 1_000);
    return () => window.clearTimeout(timeout);
  }, [seconds, recovery.retryAt]);
  const busy = recovery.isRetrying || recovery.isChangingAccount;
  const disabled = busy || seconds > 0;
  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary-50 px-5 py-10">
      <section
        className="w-full max-w-lg rounded-3xl border border-secondary-200 bg-white p-6 shadow-soft sm:p-8"
        aria-labelledby="auth-recovery-title"
        aria-busy={busy}
      >
        <div className="mb-6 inline-flex rounded-2xl bg-primary-50 p-3 text-primary-700">
          <ShieldCheck className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1
          ref={heading}
          tabIndex={-1}
          id="auth-recovery-title"
          className="text-2xl font-semibold text-secondary-950 outline-none"
        >
          {t(`recovery.${recovery.kind}.title`)}
        </h1>
        <p className="mt-3 text-sm leading-6 text-secondary-600">
          {t(`recovery.${recovery.kind}.description`)}
        </p>
        <p className="mt-5 rounded-2xl border border-primary-100 bg-primary-50 p-4 text-sm leading-6 text-primary-950">
          {t('recovery.safety')}
        </p>
        <p className="mt-5 min-h-6 text-sm text-secondary-600" role="status" aria-live="polite">
          {recovery.isChangingAccount
            ? t('recovery.changingAccount')
            : recovery.isRetrying
              ? t('recovery.checking')
              : seconds > 0
                ? t('recovery.cooldown')
                : t('recovery.ready')}
        </p>
        {seconds > 0 && (
          <p className="mt-1 text-sm tabular-nums text-secondary-600">
            {t('recovery.wait', { seconds })}
          </p>
        )}
        {recovery.accountChangeFailed && (
          <p role="alert" className="mt-3 text-sm text-danger-700">
            {t('recovery.accountChangeFailed')}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="btn-primary min-h-12 flex-1 justify-center gap-2"
            disabled={disabled}
            onClick={recovery.retry}
          >
            <RefreshCw
              className={recovery.isRetrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              aria-hidden="true"
            />
            {t('recovery.retry')}
          </button>
          <button
            type="button"
            className="btn-secondary min-h-12 flex-1 justify-center"
            disabled={busy}
            onClick={() => {
              void recovery.signIn();
            }}
          >
            {t('recovery.signIn')}
          </button>
        </div>
      </section>
    </main>
  );
}
