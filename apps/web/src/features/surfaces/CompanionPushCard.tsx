import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Bell, BellOff } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { currentPushSubscription, isPushSupported, subscribeBrowser } from './companionPush';

const pushLanguage = (language: string | undefined) => (language?.startsWith('en') ? 'en' : 'es');

/** Opt-in for approvals, register handoffs and the sealed day on this phone. */
export function CompanionPushCard() {
  const { t, i18n } = useTranslation('companion');
  const { user } = useAuth();
  const canReceive = user?.role === 'admin' || user?.role === 'manager';
  const supported = canReceive && isPushSupported();
  // undefined until the browser's own subscription has been read.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [permission, setPermission] = useState(() =>
    supported ? Notification.permission : 'default'
  );
  const utils = trpc.useUtils();

  // A permission changed in the browser's site settings applies when the person comes back.
  useEffect(() => {
    if (!supported) return;
    const refresh = () => setPermission(Notification.permission);
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [supported]);
  const language = pushLanguage(i18n.resolvedLanguage ?? i18n.language);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    void currentPushSubscription()
      .then(subscription => {
        if (live) setEndpoint(subscription?.endpoint ?? null);
      })
      .catch(() => {
        if (live) setEndpoint(null);
      });
    return () => {
      live = false;
    };
  }, [supported]);

  const status = trpc.ownerPush.status.useQuery(
    { endpoint: endpoint ?? null },
    { enabled: supported && endpoint !== undefined, staleTime: 60_000 }
  );
  const subscribe = trpc.ownerPush.subscribe.useMutation();
  const unsubscribe = trpc.ownerPush.unsubscribe.useMutation();
  const subscribeAsync = subscribe.mutateAsync;
  const on = status.data?.subscribed === true;
  const storedLanguage = status.data?.language ?? null;
  const serverKey = status.data?.publicKey ?? null;

  // The server renders the copy, so a language change re-sends the subscription.
  useEffect(() => {
    if (!on || !serverKey || storedLanguage === language) return;
    void subscribeBrowser(serverKey)
      .then(({ payload }) => subscribeAsync({ ...payload, language }))
      .then(() => utils.ownerPush.status.invalidate())
      .catch(() => undefined);
  }, [language, on, serverKey, storedLanguage, subscribeAsync, utils]);

  if (!supported || !status.data?.available) return null;
  const blocked = permission === 'denied';
  const Icon = on ? Bell : BellOff;

  const turnOn = async () => {
    if (!serverKey) return;
    const granted =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setPermission(granted);
    if (granted !== 'granted') return;
    const { subscription, payload } = await subscribeBrowser(serverKey);
    try {
      await subscribeAsync({ ...payload, language });
    } catch (error) {
      await subscription.unsubscribe().catch(() => undefined);
      throw error;
    }
    setEndpoint(payload.endpoint);
  };

  const turnOff = async () => {
    const subscription = await currentPushSubscription();
    if (endpoint) await unsubscribe.mutateAsync({ endpoint });
    await subscription?.unsubscribe();
    setEndpoint(null);
  };

  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await (on ? turnOff() : turnOn());
    } catch {
      setFailed(true);
    } finally {
      await utils.ownerPush.status.invalidate();
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-1 p-4" data-testid="companion-push">
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        <h2
          id="companion-push-title"
          className="flex min-w-0 items-center gap-2 text-sm font-semibold text-secondary-600"
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('push.title')}
        </h2>
        <input
          type="checkbox"
          role="switch"
          aria-labelledby="companion-push-title"
          className="pv-switch shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          checked={on}
          disabled={busy || blocked}
          onChange={() => void toggle()}
          data-testid="companion-push-toggle"
        />
      </div>
      {blocked ? (
        <p
          className="flex items-start gap-1.5 pt-1 text-xs font-medium text-warning-900"
          role="status"
          data-testid="companion-push-blocked"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('push.blocked')}
        </p>
      ) : null}
      {failed ? (
        <p
          className="pt-1 text-xs text-danger-700"
          role="alert"
          data-testid="companion-push-failed"
        >
          {t('push.failed')}
        </p>
      ) : null}
    </section>
  );
}
