import type { RuntimeConfig } from '@puntovivo/server';

type RuntimeSecurityConfig = Pick<RuntimeConfig, 'bindHost' | 'bindPort' | 'hubUrl'>;

const FONT_CONNECT_SOURCES = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

function originFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function webSocketOriginFromHttpOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
      return parsed.origin;
    }
    if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function buildApiOrigins(runtime: RuntimeSecurityConfig): string[] {
  const configuredBindHost =
    runtime.bindHost === '0.0.0.0' || runtime.bindHost === '::'
      ? null
      : `http://${formatHostForUrl(runtime.bindHost)}:${runtime.bindPort}`;

  return unique([
    `http://localhost:${runtime.bindPort}`,
    `http://127.0.0.1:${runtime.bindPort}`,
    configuredBindHost,
    originFromUrl(runtime.hubUrl),
  ]);
}

export function isFastifyApiResponse(url: string, runtime: RuntimeSecurityConfig): boolean {
  try {
    const parsed = new URL(url);
    return buildApiOrigins(runtime).includes(parsed.origin) && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export function buildRendererContentSecurityPolicy(args: {
  isPackagedBuild: boolean;
  runtime: RuntimeSecurityConfig;
  webDevServerUrl: string;
  /**
   * telemetry DSN (PUNTOVIVO_SENTRY_DSN). When set, its
   * origin joins connect-src so a renderer built with the lazy
   * Sentry adapter can POST envelopes; unset keeps the strict
   * baseline. Invalid values are ignored (originFromUrl → null).
   */
  sentryDsn?: string | null | undefined;
}): string {
  const apiOrigins = buildApiOrigins(args.runtime);
  const devServerOrigin = originFromUrl(args.webDevServerUrl);
  const connectSources = unique([
    "'self'",
    ...apiOrigins,
    webSocketOriginFromHttpOrigin(devServerOrigin),
    ...FONT_CONNECT_SOURCES,
    originFromUrl(args.sentryDsn),
  ]);
  const scriptSrc = args.isPackagedBuild ? "'self'" : "'self' 'unsafe-inline' 'unsafe-eval'";

  return (
    `default-src 'self'; ` +
    `base-uri 'self'; ` +
    `object-src 'none'; ` +
    `frame-ancestors 'none'; ` +
    `connect-src ${connectSources.join(' ')}; ` +
    `img-src 'self' data: blob: https:; ` +
    `font-src 'self' data: https://fonts.gstatic.com; ` +
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
    `script-src ${scriptSrc} blob:; ` +
    `worker-src 'self' blob:;`
  );
}

export function buildRendererSecurityHeaders(args: {
  isPackagedBuild: boolean;
  runtime: RuntimeSecurityConfig;
  webDevServerUrl: string;
  /** See {@link buildRendererContentSecurityPolicy}. */
  sentryDsn?: string | null | undefined;
}): Record<string, string[]> {
  return {
    'Content-Security-Policy': [buildRendererContentSecurityPolicy(args)],
    'X-Frame-Options': ['DENY'],
    'X-Content-Type-Options': ['nosniff'],
    'Referrer-Policy': ['no-referrer'],
  };
}
