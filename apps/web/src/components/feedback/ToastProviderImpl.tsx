import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  ToastContext,
  type ToastContextValue,
  type ToastInput,
  type ToastRecord,
  type ToastTone,
} from './ToastContext';

const defaultDurationMs = 4000;

function getToastClasses(tone: ToastTone): string {
  if (tone === 'success') {
    return 'border-success-500/20 bg-success-50 text-success-700';
  }

  if (tone === 'error') {
    return 'border-danger-200 bg-danger-50 text-danger-700';
  }

  if (tone === 'warning') {
    return 'border-warning-500/20 bg-warning-50 text-warning-700';
  }

  return 'border-primary-200 bg-primary-50 text-primary-700';
}

function getToastIcon(tone: ToastTone) {
  if (tone === 'success') {
    return CheckCircle2;
  }

  if (tone === 'error') {
    return XCircle;
  }

  if (tone === 'warning') {
    return TriangleAlert;
  }

  return Info;
}

async function runToastAction(toast: ToastRecord, onDismiss: (toastId: string) => void) {
  try {
    await toast.action?.onClick();
    onDismiss(toast.id);
  } catch {
    // Keep the actionable toast visible. The callback owns any domain-specific
    // retry/reporting UX, while this boundary prevents an unhandled rejection.
  }
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (toastId: string) => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3">
      {toasts.map(toast => {
        const Icon = getToastIcon(toast.tone);

        return (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto rounded-2xl border p-4 shadow-soft animate-fade-in backdrop-blur',
              getToastClasses(toast.tone)
            )}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description && (
                  <p className="mt-1 text-sm opacity-90">{toast.description}</p>
                )}
                {toast.action && (
                  <button
                    type="button"
                    className="mt-3 rounded-lg border border-current/25 px-3 py-1.5 text-sm font-semibold transition hover:bg-black/5 focus-visible:shadow-[var(--focus-ring)]"
                    onClick={() => {
                      void runToastAction(toast, onDismiss);
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="rounded-md p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100"
                onClick={() => onDismiss(toast.id)}
                aria-label={t('toast.dismiss', { title: toast.title })}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timeoutIdsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((toastId: string) => {
    const timeoutId = timeoutIdsRef.current.get(toastId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(toastId);
    }

    setToasts(currentToasts => currentToasts.filter(toast => toast.id !== toastId));
  }, []);

  const show = useCallback(
    ({
      tone = 'info',
      durationMs = defaultDurationMs,
      ...toast
    }: ToastInput & { tone?: ToastTone }) => {
      const id = crypto.randomUUID();
      setToasts(currentToasts => [...currentToasts, { ...toast, tone, id, durationMs }]);

      const timeoutId = setTimeout(() => {
        dismiss(id);
      }, durationMs);
      timeoutIdsRef.current.set(id, timeoutId);

      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;

    return () => {
      for (const timeoutId of timeoutIds.values()) {
        clearTimeout(timeoutId);
      }
      timeoutIds.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: toast => show({ ...toast, tone: 'success' }),
      error: toast => show({ ...toast, tone: 'error' }),
      info: toast => show({ ...toast, tone: 'info' }),
      warning: toast => show({ ...toast, tone: 'warning' }),
      dismiss,
    }),
    [dismiss, show]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
