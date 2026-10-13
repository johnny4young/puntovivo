import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { captureRenderError } from '@/lib/observability';
import { Button } from '@/components/ui/Button';

interface AppErrorFallbackProps {
  onRetry: () => void;
  /**
   * `app` renders the fullscreen crash card (root boundary); `route`
   * renders the same card sized for the page slot inside the shell so a
   * crashed page never unmounts the navigation or the rest of the POS.
   */
  variant?: 'app' | 'route';
}

function AppErrorFallback({ onRetry, variant = 'app' }: AppErrorFallbackProps) {
  // Diagnostics belong to captureRenderError, never the operator-facing fallback.
  const { t } = useTranslation('errors');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // The crash unmounted whatever held focus, which drops it to <body>.
    // Land keyboard and screen-reader users on the fallback instead, but
    // never steal focus from live shell chrome (a header search, a drawer)
    // that survived a route-level crash.
    const active = document.activeElement;
    if (!active || active === document.body) headingRef.current?.focus();
  }, []);

  return (
    <div
      className={
        variant === 'app'
          ? 'flex min-h-screen items-center justify-center bg-secondary-50 px-6 py-12'
          : 'flex min-h-[50vh] items-center justify-center px-6 py-12'
      }
    >
      <div className="w-full max-w-xl rounded-3xl border border-danger-200 bg-surface p-8 shadow-soft">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-50">
          <AlertTriangle className="h-7 w-7 text-danger-600" />
        </div>
        <div role="alert" className="mt-6 space-y-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold text-secondary-900 focus:outline-none"
          >
            {t('boundary.title')}
          </h1>
          <p className="text-sm text-secondary-600">{t('boundary.description')}</p>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {t('boundary.retry')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('boundary.reload')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface BoundaryInnerProps {
  children: ReactNode;
  onRetry: () => void;
  variant?: 'app' | 'route';
  /**
   * When this value changes while the fallback is showing, the boundary
   * clears its error so the newly requested content renders. React Router
   * reuses sibling route elements of the same type, so without it a crashed
   * page's fallback would follow the operator to every other shell route.
   */
  resetKey?: string;
}

interface BoundaryInnerState {
  // Only the fact of the failure is kept; the Error itself goes to
  // captureRenderError and is never retained for rendering.
  hasError: boolean;
  resetKey: string | undefined;
}

class BoundaryInner extends Component<BoundaryInnerProps, BoundaryInnerState> {
  override state: BoundaryInnerState = {
    hasError: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError(): Partial<BoundaryInnerState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: BoundaryInnerProps,
    state: BoundaryInnerState
  ): Partial<BoundaryInnerState> | null {
    return props.resetKey === state.resetKey ? null : { hasError: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // funnel render-tree errors through the observability
    // pipe. The console fallback inside `captureRenderError` keeps
    // the previous developer-tail behaviour while the future adapter
    // (Sentry / GlitchTip) gets the same payload.
    captureRenderError(error, {
      source: 'render',
      componentStack: errorInfo.componentStack ?? null,
    });
  }

  override render() {
    if (this.state.hasError) {
      return (
        <AppErrorFallback onRetry={this.props.onRetry} variant={this.props.variant ?? 'app'} />
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
 * entire app. Retry remounts only the crashed page subtree, and navigating
 * to another location clears the fallback so it never sticks to the shell.
 */
export function RouteErrorBoundary({ children }: AppErrorBoundaryProps) {
  const [resetCount, setResetCount] = useState(0);
  const { pathname, search } = useLocation();

  return (
    <BoundaryInner
      key={resetCount}
      variant="route"
      resetKey={`${pathname}${search}`}
      onRetry={() => setResetCount(current => current + 1)}
    >
      {children}
    </BoundaryInner>
  );
}
