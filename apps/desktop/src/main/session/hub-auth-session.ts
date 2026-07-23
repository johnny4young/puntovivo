/**
 * Store Hub authentication custody for Electron hub clients.
 *
 * A packaged renderer is loaded from `file://`, so it cannot safely or
 * reliably own a remote hub's strict refresh cookie. This module keeps the
 * long-lived refresh + CSRF pair in Electron main, sealed with `safeStorage`,
 * and returns only short-lived access tokens across the preload bridge.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { SafeStorageLike } from '../db-key-store.js';
import type { AccessTokenVerifier, DesktopSessionIdentity } from './desktopSession.js';

const REFRESH_COOKIE_NAME = 'puntovivo_refresh';
const CSRF_COOKIE_NAME = 'puntovivo_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

export const HUB_AUTH_STATE_FILE = 'hub-auth-session.v1.enc';

export interface HubLoginInput {
  email: string;
  password: string;
}

export interface HubSwitchStaffInput {
  targetUserId: string;
  pin: string;
}

export interface HubAccessGrant {
  token: string;
  sessionExpiresAt?: string;
}

export interface HubApiRequest {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
}

export interface HubApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface HubAuthErrorShape {
  message: string;
  errorCode?: string;
  trpcCode?: string;
  status?: number;
}

export type HubAuthIpcResult<T> = { ok: true; data: T } | { ok: false; error: HubAuthErrorShape };

interface HubAuthUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}

interface StoredHubAuthState {
  version: 1;
  hubUrl: string;
  refreshToken: string;
  csrfToken: string;
  identity: DesktopSessionIdentity;
}

interface TrpcEnvelope<T> {
  result?: { data?: T };
  error?: {
    message?: string;
    data?: { code?: string; errorCode?: string; httpStatus?: number };
    json?: {
      message?: string;
      data?: { code?: string; errorCode?: string; httpStatus?: number };
    };
  };
}

export class HubAuthRemoteError extends Error {
  readonly errorCode: string | undefined;
  readonly trpcCode: string | undefined;
  readonly status: number | undefined;

  constructor(shape: HubAuthErrorShape) {
    super(shape.message);
    this.name = 'HubAuthRemoteError';
    this.errorCode = shape.errorCode;
    this.trpcCode = shape.trpcCode;
    this.status = shape.status;
  }
}

export interface CreateHubAuthSessionOptions {
  hubUrl: string;
  getStatePath: () => string;
  safeStorage: SafeStorageLike;
  allowInsecureLoopback?: boolean;
  platform?: NodeJS.Platform;
  fetchImpl?: typeof fetch;
}

export interface HubAuthSession {
  login(input: HubLoginInput): Promise<HubAccessGrant>;
  refresh(): Promise<HubAccessGrant>;
  switchStaff(input: HubSwitchStaffInput): Promise<HubAccessGrant>;
  logout(): Promise<void>;
  request(input: HubApiRequest): Promise<HubApiResponse>;
  clear(): void;
  verifyAccessToken: AccessTokenVerifier;
}

const HUB_API_REQUEST_HEADERS = new Set([
  'accept',
  'authorization',
  'content-type',
  'x-correlation-id',
  'x-device-id',
  'x-puntovivo-envelope',
  'x-site-id',
]);

const HUB_API_RESPONSE_HEADERS = new Set([
  'content-disposition',
  'content-type',
  'x-correlation-id',
]);

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeHubAuthUrl(raw: string, allowInsecureLoopback = false): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('PUNTOVIVO_HUB_URL must be a valid absolute URL');
  }
  if (url.username || url.password) {
    throw new Error('PUNTOVIVO_HUB_URL must not contain embedded credentials');
  }
  if (url.protocol !== 'https:') {
    const allowedDevUrl =
      allowInsecureLoopback && url.protocol === 'http:' && isLoopbackHost(url.hostname);
    if (!allowedDevUrl) {
      throw new Error(
        'PUNTOVIVO_HUB_URL must use HTTPS; HTTP is allowed only for loopback development'
      );
    }
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function assertSafeStorage(safeStorage: SafeStorageLike, platform: NodeJS.Platform): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain is unavailable; refusing to persist Store Hub credentials');
  }
  if (platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error(
      'Linux safeStorage selected the insecure basic_text backend; refusing to persist Store Hub credentials'
    );
  }
}

function parseCookie(headers: Headers, name: string): string | null {
  const values =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie')!]
        : [];
  for (const value of values) {
    const match = value.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`));
    if (match?.[1]) return match[1];
  }
  return null;
}

function toIdentity(user: HubAuthUser, accessToken: string): DesktopSessionIdentity {
  let tokenIdentity: DesktopSessionIdentity | null = null;
  try {
    const payloadPart = accessToken.split('.')[1];
    if (payloadPart) {
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
        userId?: unknown;
        tenantId?: unknown;
        email?: unknown;
        role?: unknown;
        sessionVersion?: unknown;
      };
      if (
        typeof payload.userId === 'string' &&
        typeof payload.tenantId === 'string' &&
        typeof payload.email === 'string' &&
        typeof payload.role === 'string' &&
        typeof payload.sessionVersion === 'number' &&
        Number.isInteger(payload.sessionVersion)
      ) {
        tokenIdentity = {
          userId: payload.userId,
          tenantId: payload.tenantId,
          email: payload.email,
          role: payload.role,
          sessionVersion: payload.sessionVersion,
        };
      }
    }
  } catch {
    // Fall through to the response identity below. The response came from the
    // fixed hub URL; the JWT decode is a consistency check, not verification.
  }
  if (
    tokenIdentity &&
    (tokenIdentity.userId !== user.id ||
      tokenIdentity.tenantId !== user.tenantId ||
      tokenIdentity.email !== user.email ||
      tokenIdentity.role !== user.role)
  ) {
    throw new Error('Store Hub returned inconsistent access-token identity');
  }
  return {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    sessionVersion: tokenIdentity?.sessionVersion ?? 0,
  };
}

function refreshIdentity(
  previous: DesktopSessionIdentity,
  accessToken: string
): DesktopSessionIdentity {
  const payloadPart = accessToken.split('.')[1];
  if (!payloadPart) return previous;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      userId?: unknown;
      tenantId?: unknown;
      email?: unknown;
      role?: unknown;
      sessionVersion?: unknown;
    };
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.sessionVersion !== 'number' ||
      !Number.isInteger(payload.sessionVersion)
    ) {
      return previous;
    }
    if (payload.userId !== previous.userId || payload.tenantId !== previous.tenantId) {
      throw new Error('Store Hub returned inconsistent refreshed access-token identity');
    }
    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
      sessionVersion: payload.sessionVersion,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Store Hub returned')) throw error;
    // Test doubles and legacy grants may omit decodable JWT claims. Keeping
    // the previously authenticated identity is safer than accepting a partial
    // renderer-supplied shape.
    return previous;
  }
}

function errorShape(error: unknown): HubAuthErrorShape {
  if (error instanceof HubAuthRemoteError) {
    return {
      message: error.message,
      ...(error.errorCode ? { errorCode: error.errorCode } : {}),
      ...(error.trpcCode ? { trpcCode: error.trpcCode } : {}),
      ...(error.status ? { status: error.status } : {}),
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export async function captureHubAuthIpc<T>(
  operation: () => Promise<T>
): Promise<HubAuthIpcResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: errorShape(error) };
  }
}

export function createHubAuthSession(options: CreateHubAuthSessionOptions): HubAuthSession {
  const fetchImpl = options.fetchImpl ?? fetch;
  const platform = options.platform ?? process.platform;
  const hubUrl = normalizeHubAuthUrl(options.hubUrl, options.allowInsecureLoopback ?? false);
  let currentAccessToken: string | null = null;
  let currentIdentity: DesktopSessionIdentity | null = null;
  let refreshInFlight: Promise<HubAccessGrant> | null = null;

  function removeStateFile(): void {
    const path = options.getStatePath();
    for (const candidate of [path, `${path}.tmp`, `${path}.bak`]) {
      if (existsSync(candidate)) unlinkSync(candidate);
    }
  }

  function saveState(state: StoredHubAuthState): void {
    assertSafeStorage(options.safeStorage, platform);
    const path = options.getStatePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp`;
    if (existsSync(tmpPath)) unlinkSync(tmpPath);
    const sealed = options.safeStorage.encryptString(JSON.stringify(state));
    writeFileSync(tmpPath, sealed, { flag: 'wx' });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // Windows ACL + DPAPI remain the primary boundary.
    }
    const backupPath = `${path}.bak`;
    try {
      if (platform === 'win32' && existsSync(path)) {
        if (existsSync(backupPath)) unlinkSync(backupPath);
        renameSync(path, backupPath);
        try {
          renameSync(tmpPath, path);
        } catch (error) {
          renameSync(backupPath, path);
          throw error;
        }
        try {
          unlinkSync(backupPath);
        } catch {
          // The new state is already installed. A stale encrypted backup is
          // removed on the next load or explicit clear.
        }
      } else {
        renameSync(tmpPath, path);
      }
    } catch (error) {
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
      } catch {
        // Surface the rename failure.
      }
      throw error;
    }
  }

  function loadState(): StoredHubAuthState | null {
    const path = options.getStatePath();
    const tmpPath = `${path}.tmp`;
    const backupPath = `${path}.bak`;
    if (!existsSync(path) && existsSync(tmpPath)) {
      renameSync(tmpPath, path);
      if (existsSync(backupPath)) {
        try {
          unlinkSync(backupPath);
        } catch {
          // The recovered current state remains authoritative.
        }
      }
    } else if (!existsSync(path) && existsSync(backupPath)) {
      renameSync(backupPath, path);
    } else if (existsSync(path) && existsSync(backupPath)) {
      try {
        unlinkSync(backupPath);
      } catch {
        // The current state remains authoritative.
      }
    }
    if (!existsSync(path)) return null;
    assertSafeStorage(options.safeStorage, platform);
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.safeStorage.decryptString(readFileSync(path)));
    } catch (error) {
      throw new Error(`failed to decrypt Store Hub credentials at ${path}`, { cause: error });
    }
    if (!parsed || typeof parsed !== 'object')
      throw new Error('invalid Store Hub credential state');
    const state = parsed as Partial<StoredHubAuthState>;
    if (
      state.version !== 1 ||
      state.hubUrl !== hubUrl ||
      typeof state.refreshToken !== 'string' ||
      typeof state.csrfToken !== 'string' ||
      !state.identity ||
      typeof state.identity.userId !== 'string' ||
      typeof state.identity.tenantId !== 'string' ||
      typeof state.identity.email !== 'string' ||
      typeof state.identity.role !== 'string' ||
      typeof state.identity.sessionVersion !== 'number' ||
      !Number.isInteger(state.identity.sessionVersion)
    ) {
      throw new Error('invalid or mismatched Store Hub credential state');
    }
    return state as StoredHubAuthState;
  }

  async function call<T>(
    procedure: string,
    input: unknown,
    auth?: { accessToken?: string; state?: StoredHubAuthState }
  ): Promise<{ data: T; headers: Headers }> {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (auth?.accessToken) headers.set('authorization', `Bearer ${auth.accessToken}`);
    if (auth?.state) {
      headers.set(
        'cookie',
        `${REFRESH_COOKIE_NAME}=${auth.state.refreshToken}; ${CSRF_COOKIE_NAME}=${auth.state.csrfToken}`
      );
      headers.set(CSRF_HEADER_NAME, auth.state.csrfToken);
    }
    const response = await fetchImpl(`${hubUrl}/api/trpc/${procedure}?batch=1`, {
      method: 'POST',
      headers,
      body: input === undefined ? '{}' : JSON.stringify({ '0': input }),
    });
    let envelope: TrpcEnvelope<T> | undefined;
    try {
      const body = (await response.json()) as TrpcEnvelope<T> | TrpcEnvelope<T>[];
      envelope = Array.isArray(body) ? body[0] : body;
    } catch {
      throw new HubAuthRemoteError({
        message: `Store Hub returned an invalid authentication response (${response.status})`,
        status: response.status,
      });
    }
    const remoteError = envelope?.error?.json ?? envelope?.error;
    if (!response.ok || remoteError || envelope?.result?.data === undefined) {
      throw new HubAuthRemoteError({
        message: remoteError?.message ?? `Store Hub authentication failed (${response.status})`,
        ...(remoteError?.data?.errorCode ? { errorCode: remoteError.data.errorCode } : {}),
        ...(remoteError?.data?.code ? { trpcCode: remoteError.data.code } : {}),
        status: remoteError?.data?.httpStatus ?? response.status,
      });
    }
    return { data: envelope.result.data, headers: response.headers };
  }

  async function request(input: HubApiRequest): Promise<HubApiResponse> {
    if (!input.path.startsWith('/api/') || input.path.startsWith('//')) {
      throw new Error('Store Hub proxy accepts only relative /api/ paths');
    }
    const target = new URL(input.path, `${hubUrl}/`);
    if (target.origin !== new URL(hubUrl).origin || !target.pathname.startsWith('/api/')) {
      throw new Error('Store Hub proxy target escaped the configured hub');
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(input.headers)) {
      const normalizedName = name.toLowerCase();
      if (HUB_API_REQUEST_HEADERS.has(normalizedName)) {
        headers.set(normalizedName, value);
      }
    }
    const response = await fetchImpl(target, {
      method: input.method,
      headers,
      ...(input.body !== undefined && input.method !== 'GET' ? { body: input.body } : {}),
    });
    const responseHeaders: Record<string, string> = {};
    for (const [name, value] of response.headers.entries()) {
      if (HUB_API_RESPONSE_HEADERS.has(name.toLowerCase())) {
        responseHeaders[name.toLowerCase()] = value;
      }
    }
    return {
      status: response.status,
      headers: responseHeaders,
      body: await response.text(),
    };
  }

  function updateCookies(
    headers: Headers,
    previous?: Pick<StoredHubAuthState, 'refreshToken' | 'csrfToken'>
  ): Pick<StoredHubAuthState, 'refreshToken' | 'csrfToken'> {
    const refreshToken = parseCookie(headers, REFRESH_COOKIE_NAME) ?? previous?.refreshToken;
    const csrfToken = parseCookie(headers, CSRF_COOKIE_NAME) ?? previous?.csrfToken;
    if (!refreshToken || !csrfToken) {
      throw new Error('Store Hub did not provide the required renewable-session cookies');
    }
    return { refreshToken, csrfToken };
  }

  function installGrant(
    token: string,
    identity: DesktopSessionIdentity,
    cookies: Pick<StoredHubAuthState, 'refreshToken' | 'csrfToken'>
  ): void {
    const state: StoredHubAuthState = { version: 1, hubUrl, identity, ...cookies };
    saveState(state);
    currentAccessToken = token;
    currentIdentity = identity;
  }

  async function login(input: HubLoginInput): Promise<HubAccessGrant> {
    const response = await call<{ token: string; user: HubAuthUser }>('auth.login', input);
    const cookies = updateCookies(response.headers);
    const identity = toIdentity(response.data.user, response.data.token);
    installGrant(response.data.token, identity, cookies);
    return { token: response.data.token };
  }

  async function refresh(): Promise<HubAccessGrant> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const state = loadState();
      if (!state)
        throw new HubAuthRemoteError({ message: 'Store Hub session is missing', status: 401 });
      try {
        const response = await call<{ token: string }>('auth.refresh', undefined, { state });
        const cookies = updateCookies(response.headers, state);
        installGrant(
          response.data.token,
          refreshIdentity(state.identity, response.data.token),
          cookies
        );
        return { token: response.data.token };
      } catch (error) {
        if (error instanceof HubAuthRemoteError && (error.status === 401 || error.status === 403)) {
          removeStateFile();
          currentAccessToken = null;
          currentIdentity = null;
        }
        throw error;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function switchStaff(input: HubSwitchStaffInput): Promise<HubAccessGrant> {
    const state = loadState();
    if (!state || !currentAccessToken) {
      throw new HubAuthRemoteError({ message: 'Store Hub session is missing', status: 401 });
    }
    const response = await call<{
      token: string;
      user: HubAuthUser;
      sessionExpiresAt: string;
    }>('auth.switchStaff', input, { accessToken: currentAccessToken, state });
    const cookies = updateCookies(response.headers, state);
    const identity = toIdentity(response.data.user, response.data.token);
    installGrant(response.data.token, identity, cookies);
    return { token: response.data.token, sessionExpiresAt: response.data.sessionExpiresAt };
  }

  async function logout(): Promise<void> {
    try {
      const state = loadState();
      const token = currentAccessToken;
      if (state && token) {
        await call('auth.logout', undefined, { accessToken: token, state });
      }
    } finally {
      removeStateFile();
      currentAccessToken = null;
      currentIdentity = null;
    }
  }

  function clear(): void {
    removeStateFile();
    currentAccessToken = null;
    currentIdentity = null;
  }

  const verifyAccessToken: AccessTokenVerifier = async token =>
    token === currentAccessToken && currentIdentity ? { ...currentIdentity } : null;

  return { login, refresh, switchStaff, logout, request, clear, verifyAccessToken };
}
