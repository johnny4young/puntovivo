import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// capture the web-vitals callbacks + spy on the tRPC mutation.
// `vi.hoisted` keeps these references valid inside the hoisted `vi.mock`
// factories below.
const { mutateMock, bootstrapMock, handlers } = vi.hoisted(() => ({
  mutateMock: vi.fn(() => Promise.resolve({ accepted: true })),
  bootstrapMock: vi.fn(() => Promise.resolve()),
  handlers: {} as Record<string, (metric: unknown) => void>,
}));

vi.mock('../apiBootstrap', () => ({ ensureApiBootstrap: bootstrapMock }));

vi.mock('../trpc', () => ({
  vanillaClient: {
    observability: { reportWebVital: { mutate: mutateMock } },
  },
  // captureRenderError defaults its correlationId from
  // this; the webVitals cases never mint requests, so null is right.
  getLastCorrelationId: () => null,
}));

vi.mock('web-vitals', () => ({
  onLCP: (cb: (m: unknown) => void) => {
    handlers.LCP = cb;
  },
  onCLS: (cb: (m: unknown) => void) => {
    handlers.CLS = cb;
  },
  onINP: (cb: (m: unknown) => void) => {
    handlers.INP = cb;
  },
  onTTFB: (cb: (m: unknown) => void) => {
    handlers.TTFB = cb;
  },
  onFCP: (cb: (m: unknown) => void) => {
    handlers.FCP = cb;
  },
}));

import {
  installWebVitalsReporter,
  resolveDeviceClass,
  __resetRenderObservabilityForTests,
} from '../observability';

function setHardwareConcurrency(value: number | undefined): void {
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
    configurable: true,
    value,
  });
}

const originalCores = globalThis.navigator.hardwareConcurrency;

beforeEach(() => {
  __resetRenderObservabilityForTests();
  mutateMock.mockClear();
  bootstrapMock.mockReset().mockResolvedValue(undefined);
  for (const key of Object.keys(handlers)) delete handlers[key];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setHardwareConcurrency(originalCores);
});

describe('resolveDeviceClass', () => {
  it('buckets by logical core count', () => {
    setHardwareConcurrency(2);
    expect(resolveDeviceClass()).toBe('low');
    setHardwareConcurrency(4);
    expect(resolveDeviceClass()).toBe('mid');
    setHardwareConcurrency(6);
    expect(resolveDeviceClass()).toBe('mid');
    setHardwareConcurrency(8);
    expect(resolveDeviceClass()).toBe('high');
  });

  it('returns "unknown" when hardwareConcurrency is missing or invalid', () => {
    setHardwareConcurrency(undefined);
    expect(resolveDeviceClass()).toBe('unknown');
    setHardwareConcurrency(0);
    expect(resolveDeviceClass()).toBe('unknown');
  });
});

describe('installWebVitalsReporter', () => {
  it('registers all five Web Vitals callbacks when the load is sampled', () => {
    setHardwareConcurrency(4);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // < default dev rate (1.0)

    installWebVitalsReporter();

    expect(Object.keys(handlers).sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);
  });

  it('forwards a finalised metric to reportWebVital with the right payload', async () => {
    setHardwareConcurrency(4);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    installWebVitalsReporter();
    handlers.LCP?.({ name: 'LCP', value: 2480.5, rating: 'good' });

    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    expect(mutateMock).toHaveBeenCalledWith({
      metric: 'LCP',
      value: 2480.5,
      rating: 'good',
      route: window.location.pathname,
      deviceClass: 'mid',
    });
  });

  it('retains first-paint values and route while waiting for safe bootstrap', async () => {
    let ready!: () => void;
    bootstrapMock.mockReturnValue(
      new Promise<void>(resolve => {
        ready = resolve;
      })
    );
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const originalPath = window.location.pathname;
    window.history.replaceState(null, '', '/login');
    try {
      installWebVitalsReporter();
      const metric = { name: 'FCP', value: 120, rating: 'good' };
      handlers.FCP?.(metric);
      metric.value = 999;
      window.history.replaceState(null, '', '/dashboard');
      expect(mutateMock).not.toHaveBeenCalled();
      ready();
      await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: 'FCP',
          value: 120,
          route: '/login',
        })
      );
    } finally {
      window.history.replaceState(null, '', originalPath);
    }
  });

  it('drops the sample when bootstrap fails without sending an unsafe mutation', async () => {
    bootstrapMock.mockRejectedValue(new Error('offline'));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    installWebVitalsReporter();
    handlers.FCP?.({ name: 'FCP', value: 120, rating: 'good' });
    await expect(bootstrapMock.mock.results[0]?.value).rejects.toThrow('offline');
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('skips reporting entirely when the load is not sampled', () => {
    vi.stubEnv('VITE_WEB_VITALS_SAMPLE_RATE', '0');
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // >= rate 0 -> skip

    installWebVitalsReporter();

    expect(Object.keys(handlers)).toHaveLength(0);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('is idempotent — a second call does not double-register', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    installWebVitalsReporter();
    for (const key of Object.keys(handlers)) delete handlers[key];
    installWebVitalsReporter();
    expect(Object.keys(handlers)).toHaveLength(0);
  });

  it('honours an explicit VITE_WEB_VITALS_SAMPLE_RATE override', () => {
    vi.stubEnv('VITE_WEB_VITALS_SAMPLE_RATE', '0.5');
    vi.spyOn(Math, 'random').mockReturnValue(0.4); // < 0.5 -> sampled
    installWebVitalsReporter();
    expect(Object.keys(handlers)).toHaveLength(5);
  });
});
