import { StrictMode, Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter } from 'react-router';
import { AppErrorBoundary } from './components/feedback/AppErrorBoundary';
import { ThemeProvider } from './components/feedback/ThemeProvider';
import { ToastProvider } from './components/feedback/ToastProvider';
import { createTrpcBatchLink, trpc } from './lib/trpc';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

/**
 * Defensive top-level Suspense fallback. It intentionally avoids translations
 * so it remains available before any feature namespace has loaded.
 */
function RootSuspenseFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary-50">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-secondary-200 border-t-primary-600" />
    </div>
  );
}

export function AppRoot() {
  // The packaged Electron renderer uses the puntovivo-app:// scheme. HashRouter
  // keeps client routes behind # so every navigation stays on the single
  // protocol-backed index document; HTTP(S) builds retain clean history URLs.
  const Router =
    window.location.protocol === 'http:' || window.location.protocol === 'https:'
      ? BrowserRouter
      : HashRouter;
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [createTrpcBatchLink()],
    })
  );

  return (
    <StrictMode>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Router>
            <AppErrorBoundary>
              <ToastProvider>
                <ThemeProvider>
                  <Suspense fallback={<RootSuspenseFallback />}>
                    <App />
                  </Suspense>
                </ThemeProvider>
              </ToastProvider>
            </AppErrorBoundary>
          </Router>
        </QueryClientProvider>
      </trpc.Provider>
    </StrictMode>
  );
}
