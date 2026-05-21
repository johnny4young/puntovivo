import './i18n'; // initialize i18next before any component renders
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { createTrpcBatchLink, trpc } from './lib/trpc';
import { AppErrorBoundary } from './components/feedback/AppErrorBoundary';
import { ToastProvider } from './components/feedback/ToastProvider';
import { ThemeProvider } from './components/feedback/ThemeProvider';
import { installGlobalErrorListeners } from './lib/observability';
import App from './App';
import './index.css';

// ENG-135 — install window-level error / unhandledrejection
// listeners before the React tree mounts so even a crash in the
// `Root` render still reaches the observability pipe.
installGlobalErrorListeners();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

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
                  <App />
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
