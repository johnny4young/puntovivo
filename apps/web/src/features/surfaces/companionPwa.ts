interface CompanionServiceWorkerEnvironment {
  production: boolean;
  protocol: string;
  pathname: string;
  serviceWorkerSupported: boolean;
}

/** Keep the PWA worker out of Electron, development and non-Companion routes. */
export function shouldRegisterCompanionServiceWorker(
  environment: CompanionServiceWorkerEnvironment
): boolean {
  return (
    environment.production &&
    (environment.protocol === 'https:' || environment.protocol === 'http:') &&
    environment.pathname.startsWith('/c/') &&
    environment.serviceWorkerSupported
  );
}

export async function registerCompanionServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;

  const environment: CompanionServiceWorkerEnvironment = {
    production: import.meta.env.PROD,
    protocol: window.location.protocol,
    pathname: window.location.pathname,
    serviceWorkerSupported: 'serviceWorker' in navigator,
  };
  if (!shouldRegisterCompanionServiceWorker(environment)) return null;

  try {
    return await navigator.serviceWorker.register('/service-worker.js', { scope: '/c/' });
  } catch {
    // Installation is an enhancement. A blocked worker must not make the
    // authenticated read-only surface unusable or expose error details.
    console.warn('Companion service worker registration failed');
    return null;
  }
}
