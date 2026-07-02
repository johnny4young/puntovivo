import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureRenderError } from '@/lib/observability';

interface AppErrorFallbackProps {
  error: Error;
  onRetry: () => void;
  /**
   * `app` renders the fullscreen crash card (root boundary); `route`
   * renders the same card sized for the page slot inside the shell so a
   * crashed page never unmounts the navigation or the rest of the POS.
   */
  variant?: 'app' | 'route';
}

function AppErrorFallback({ error, onRetry, variant = 'app' }: AppErrorFallbackProps) {
  const { t } = useTranslation('errors');
  return (
    <div
      className={
        variant === 'app'
          ? 'flex min-h-screen items-center justify-center bg-secondary-50 px-6 py-12'
          : 'flex min-h-[50vh] items-center justify-center px-6 py-12'
      }
    >
      <div className="w-full max-w-xl rounded-3xl border border-danger-200 bg-white p-8 shadow-soft">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-50">
          <AlertTriangle className="h-7 w-7 text-danger-600" />
        </div>
        <div className="mt-6 space-y-2">
          <h1 className="text-2xl font-semibold text-secondary-900">{t('boundary.title')}</h1>
          <p className="text-sm text-secondary-600">
            {t('boundary.description')}
          </p>
        </div>
        <div className="mt-5 rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3">
          <p className="text-sm font-medium text-danger-700">{error.message}</p>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" className="btn-primary flex items-center justify-center gap-2" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {t('boundary.retry')}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('boundary.reload')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface BoundaryInnerProps {
  children: ReactNode;
  onRetry: () => void;
  variant?: 'app' | 'route';
}

interface BoundaryInnerState {
  error: Error | null;
}

class BoundaryInner extends Component<BoundaryInnerProps, BoundaryInnerState> {
  override state: BoundaryInnerState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): BoundaryInnerState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // ENG-135 — funnel render-tree errors through the observability
    // pipe. The console fallback inside `captureRenderError` keeps
    // the previous developer-tail behaviour while the future adapter
    // (Sentry / GlitchTip) gets the same payload.
    captureRenderError(error, {
      source: 'render',
      componentStack: errorInfo.componentStack ?? null,
    });
  }

  override render() {
    if (this.state.error) {
      return (
        <AppErrorFallback
          error={this.state.error}
          onRetry={this.props.onRetry}
          variant={this.props.variant ?? 'app'}
        />
      );
    }

    return this.props.children;
  }
}

interface AppErrorBoundaryProps {
  children: ReactNode;
}

export function AppErrorBoundary({ children }: AppErrorBoundaryProps) {
  const [resetCount, setResetCount] = useState(0);

  return (
    <BoundaryInner key={resetCount} onRetry={() => setResetCount(current => current + 1)}>
      {children}
    </BoundaryInner>
  );
}

/**
 * Per-route boundary mounted inside the shell (ShellRoute). Catches a
 * render crash in one page so the navigation chrome — and any other
 * mounted state, like an open cash session's page — survives; without
 * it a crash anywhere bubbles to the root boundary and unmounts the
 * entire app. Retry remounts only the crashed page subtree.
 */
export function RouteErrorBoundary({ children }: AppErrorBoundaryProps) {
  const [resetCount, setResetCount] = useState(0);

  return (
    <BoundaryInner
      key={resetCount}
      variant="route"
      onRetry={() => setResetCount(current => current + 1)}
    >
      {children}
    </BoundaryInner>
  );
}
