import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AppErrorFallbackProps {
  error: Error;
  onRetry: () => void;
}

function AppErrorFallback({ error, onRetry }: AppErrorFallbackProps) {
  const { t } = useTranslation('errors');
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary-50 px-6 py-12">
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
}

interface BoundaryInnerState {
  error: Error | null;
}

class BoundaryInner extends Component<BoundaryInnerProps, BoundaryInnerState> {
  state: BoundaryInnerState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): BoundaryInnerState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled application render error', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <AppErrorFallback error={this.state.error} onRetry={this.props.onRetry} />;
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
