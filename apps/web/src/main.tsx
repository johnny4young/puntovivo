import './i18n'; // initialize i18next before any component renders
import { createRoot } from 'react-dom/client';
import {
  installGlobalErrorListeners,
  installRenderTelemetryAdapter,
  installWebVitalsReporter,
} from './lib/observability';
import { AppRoot } from './AppRoot';
import { isCustomerDisplayEntryLocation } from './features/surfaces/customerDisplayEntry';
import './index.css';

// install window-level error / unhandledrejection
// listeners before the React tree mounts so even a crash in the
// `Root` render still reaches the observability pipe.
installGlobalErrorListeners();
// lazy-load the Sentry / GlitchTip adapter when a DSN is
// configured. Fire-and-forget: never delays the render below, and
// without VITE_PUNTOVIVO_SENTRY_DSN it is a single env read.
installRenderTelemetryAdapter();
// Keep the authority-free Customer Display outside every application API,
// including best-effort RUM. Ordinary POS loads still install the reporter at
// bootstrap so LCP / CLS / INP for the first login paint are captured.
if (!isCustomerDisplayEntryLocation(window.location)) {
  installWebVitalsReporter();
}

createRoot(document.getElementById('root')!).render(<AppRoot />);
