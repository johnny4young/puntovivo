import { StrictMode, Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  UNSAFE_createBrowserHistory,
  UNSAFE_createHashHistory,
  Route,
  Routes,
  unstable_HistoryRouter as HistoryRouter,
} from 'react-router';
import { AppErrorBoundary } from './components/feedback/AppErrorBoundary';
import { ThemeProvider } from './components/feedback/ThemeProvider';
import { ToastProvider } from './components/feedback/ToastProvider';
import { createNavigationGuardController } from './components/navigation/navigationGuardController';
import { NavigationGuardProvider } from './components/navigation/NavigationGuardProvider';
import { createGuardedHistory } from './components/navigation/guardedHistory';
import { createTrpcBatchLink, trpc } from './lib/trpc';
import { CustomerDisplayHomePlaceholder, CustomerDisplayShell } from './appLazyPages';
import { isCustomerDisplayEntryLocation } from './features/surfaces/customerDisplayEntry';
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

const navigationGuardController = createNavigationGuardController();
const appHistory = createGuardedHistory(
  window.location.protocol === 'http:' || window.location.protocol === 'https:'
    ? UNSAFE_createBrowserHistory({ v5Compat: true })
    : UNSAFE_createHashHistory({ v5Compat: true }),
  navigationGuardController
);

function CustomerDisplayRoot() {
  return (
    <StrictMode>
      <HistoryRouter history={appHistory}>
        <AppErrorBoundary>
          <ToastProvider>
            <ThemeProvider>
              <Suspense fallback={<RootSuspenseFallback />}>
                <Routes>
                  <Route path="/customer-display" element={<CustomerDisplayShell />}>
                    <Route index element={<CustomerDisplayHomePlaceholder />} />
                  </Route>
                </Routes>
              </Suspense>
            </ThemeProvider>
          </ToastProvider>
        </AppErrorBoundary>
      </HistoryRouter>
    </StrictMode>
  );
}

function AuthenticatedAppRoot() {
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [createTrpcBatchLink()],
    })
  );

  return (
    <StrictMode>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <NavigationGuardProvider controller={navigationGuardController}>
            <HistoryRouter history={appHistory}>
              <AppErrorBoundary>
                <ToastProvider>
                  <ThemeProvider>
                    <Suspense fallback={<RootSuspenseFallback />}>
                      <App />
                    </Suspense>
                  </ThemeProvider>
                </ToastProvider>
              </AppErrorBoundary>
            </HistoryRouter>
          </NavigationGuardProvider>
        </QueryClientProvider>
      </trpc.Provider>
    </StrictMode>
  );
}

export function AppRoot() {
  return isCustomerDisplayEntryLocation(window.location) ? (
    <CustomerDisplayRoot />
  ) : (
    <AuthenticatedAppRoot />
  );
}
