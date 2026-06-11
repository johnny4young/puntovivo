import './i18n'; // initialize i18next before any component renders
import { StrictMode, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { createTrpcBatchLink, trpc } from './lib/trpc';
import { AppErrorBoundary } from './components/feedback/AppErrorBoundary';
import { ToastProvider } from './components/feedback/ToastProvider';
import { ThemeProvider } from './components/feedback/ThemeProvider';
import {
  installGlobalErrorListeners,
  installRenderTelemetryAdapter,
  installWebVitalsReporter,
} from './lib/observability';
import App from './App';
import './index.css';

// ENG-135 — install window-level error / unhandledrejection
// listeners before the React tree mounts so even a crash in the
// `Root` render still reaches the observability pipe.
installGlobalErrorListeners();
// ENG-135b — lazy-load the Sentry / GlitchTip adapter when a DSN is
// configured. Fire-and-forget: never delays the render below, and
// without VITE_PUNTOVIVO_SENTRY_DSN it is a single env read.
installRenderTelemetryAdapter();
// ENG-173 — install the Web Vitals reporter at the same bootstrap point so
// LCP / CLS / INP for the very first (login) paint are captured. Sampled +
// background-only; no effect on the render path.
installWebVitalsReporter();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

/**
 * ENG-170b — defensive top-level Suspense fallback. Renders a text-only
 * spinner (no `useTranslation`, no flagged JSX attributes) so it can show
 * even before any namespace is available. Feature namespaces normally
 * suspend inside the per-route `<Suspense>` boundaries in `App.tsx`; this
 * net only fires if always-mounted shell chrome ever references a
 * non-bootstrap namespace, degrading to a brief spinner instead of an
 * unbounded suspend.
 */
function RootSuspenseFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary-50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-secondary-200 border-t-primary-600" />
    </div>
  );
}

function Root() {
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [createTrpcBatchLink()],
    })
  );

  return (
    <StrictMode>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AppErrorBoundary>
              <ToastProvider>
                <ThemeProvider>
                  <Suspense fallback={<RootSuspenseFallback />}>
                    <App />
                  </Suspense>
                </ThemeProvider>
              </ToastProvider>
            </AppErrorBoundary>
          </BrowserRouter>
        </QueryClientProvider>
      </trpc.Provider>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
