import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isTopmostModalDialog, MODAL_DIALOG_SELECTOR } from './useDialogA11y';
import {
  ToastContext,
  ToastOutletContext,
  type ToastContextValue,
  type ToastInput,
  type ToastRecord,
  type ToastTone,
} from './ToastContext';

const defaultDurationMs = 4000;

interface PlacedToast extends ToastRecord {
  // undefined until placed after commit; null renders in the page viewport.
  outlet?: HTMLElement | null | undefined;
  outletKey?: string | undefined;
  // A toast moved out of a closed dialog was already announced there.
  relocated?: boolean;
}

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

function ToastList({
  toasts,
  onDismiss,
}: {
  toasts: PlacedToast[];
  onDismiss: (toastId: string) => void;
}) {
  const { t } = useTranslation('common');

  return (
    <>
      {toasts.map(toast => {
        const Icon = getToastIcon(toast.tone);

        return (
          <div
            key={toast.id}
            data-toast-id={toast.id}
            role={toast.relocated ? undefined : toast.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto break-words rounded-2xl border p-4 shadow-soft animate-fade-in backdrop-blur',
              getToastClasses(toast.tone)
            )}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
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
                    className="mt-3 max-w-full whitespace-normal break-words rounded-lg border border-current/25 px-3 py-1.5 text-sm font-semibold transition hover:bg-black/5 focus-visible:shadow-[var(--focus-ring)]"
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
                className="shrink-0 rounded-md p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100"
                onClick={() => onDismiss(toast.id)}
                aria-label={t('toast.dismiss', { title: toast.title })}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function topmostOutlet(outlets: HTMLElement[]): HTMLElement | null {
  return (
    outlets.find(
      outlet =>
        outlet.isConnected &&
        isTopmostModalDialog(outlet.closest<HTMLElement>(MODAL_DIALOG_SELECTOR))
    ) ?? null
  );
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<PlacedToast[]>([]);
  const timeoutIdsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const outletsRef = useRef<HTMLElement[]>([]);
  const outletKeysRef = useRef(new WeakMap<HTMLElement, string>());

  const registerOutlet = useCallback((outlet: HTMLElement) => {
    outletsRef.current.push(outlet);
    outletKeysRef.current.set(outlet, crypto.randomUUID());
    return () => {
      outletsRef.current = outletsRef.current.filter(candidate => candidate !== outlet);
      setToasts(currentToasts =>
        currentToasts.some(toast => toast.outlet === outlet)
          ? currentToasts.map(toast =>
              toast.outlet === outlet ? { ...toast, outlet: undefined, relocated: true } : toast
            )
          : currentToasts
      );
    };
  }, []);

  // Place new toasts after commit, when a dialog closed in the same update is
  // already gone and a dialog opened in it has registered its outlet.
  useLayoutEffect(() => {
    if (!toasts.some(toast => toast.outlet === undefined)) return;
    const outlet = topmostOutlet(outletsRef.current);
    const outletKey = outlet ? outletKeysRef.current.get(outlet) : undefined;
    setToasts(currentToasts =>
      currentToasts.map(toast =>
        toast.outlet === undefined ? { ...toast, outlet, outletKey } : toast
      )
    );
  }, [toasts]);

  const dismiss = useCallback((toastId: string) => {
    const timeoutId = timeoutIdsRef.current.get(toastId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutIdsRef.current.delete(toastId);
    }

    // Keep keyboard focus inside the dialog when its focused toast goes away.
    const focusedToast = document.activeElement?.closest(`[data-toast-id="${toastId}"]`);
    const outlet = focusedToast?.closest('.dialog-toast-outlet');
    if (outlet?.parentElement instanceof HTMLElement) outlet.parentElement.focus();

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

  const pageToasts = toasts.filter(toast => toast.outlet === null);
  const toastsByOutlet = new Map<string, { outlet: HTMLElement; toasts: PlacedToast[] }>();
  for (const toast of toasts) {
    if (!toast.outlet || !toast.outletKey) continue;
    const group = toastsByOutlet.get(toast.outletKey) ?? { outlet: toast.outlet, toasts: [] };
    group.toasts.push(toast);
    toastsByOutlet.set(toast.outletKey, group);
  }

  return (
    <ToastContext.Provider value={value}>
      <ToastOutletContext.Provider value={registerOutlet}>{children}</ToastOutletContext.Provider>
      <div className="pointer-events-none fixed left-4 right-4 top-4 z-50 ml-auto flex max-h-[calc(100dvh-2rem)] max-w-sm flex-col gap-3 overflow-y-auto overscroll-contain sm:left-auto sm:w-full">
        <ToastList toasts={pageToasts} onDismiss={dismiss} />
      </div>
      {Array.from(toastsByOutlet, ([key, group]) =>
        createPortal(<ToastList toasts={group.toasts} onDismiss={dismiss} />, group.outlet, key)
      )}
    </ToastContext.Provider>
  );
}
