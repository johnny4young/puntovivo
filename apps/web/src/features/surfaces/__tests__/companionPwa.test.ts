import { describe, expect, it } from 'vitest';
import { shouldRegisterCompanionServiceWorker } from '../companionPwa';

const BASE = {
  production: true,
  protocol: 'https:',
  pathname: '/c/',
  serviceWorkerSupported: true,
};

describe('Companion service-worker boundary', () => {
  it('registers only for the production HTTP(S) Companion route', () => {
    expect(shouldRegisterCompanionServiceWorker(BASE)).toBe(true);
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, protocol: 'http:' })).toBe(true);
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, pathname: '/c/details' })).toBe(true);
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, pathname: '/c' })).toBe(false);
  });

  it('stays out of development, Electron, other routes and unsupported browsers', () => {
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, production: false })).toBe(false);
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, protocol: 'puntovivo:' })).toBe(false);
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, pathname: '/sales' })).toBe(false);
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, pathname: '/company' })).toBe(false);
    expect(shouldRegisterCompanionServiceWorker({ ...BASE, serviceWorkerSupported: false })).toBe(
      false
    );
  });
});
