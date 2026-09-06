import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import type { HubAccessGrant, HubAuthIpcResult, SessionAPI } from '@/types/electron';

function hubSessionApi(): SessionAPI | null {
  if (getRuntimeConfigSync().authorityMode !== 'hub_client') return null;
  return window.api?.session ?? window.session ?? null;
}

/** Load the configured-Hub HTTP adapter only when a Hub request is actually made. */
export function createHubApiFetch(): typeof fetch {
  return async (input, init) => {
    const adapter = await import('./hubApiFetch');
    return adapter.createHubApiFetch()(input, init);
  };
}

function unwrapHubResult<T>(result: HubAuthIpcResult<T>): T {
  if (result.ok) return result.data;
  const error = new Error(result.error.message) as Error & {
    data?: { errorCode?: string; code?: string; httpStatus?: number };
  };
  error.data = {
    ...(result.error.errorCode ? { errorCode: result.error.errorCode } : {}),
    ...(result.error.trpcCode ? { code: result.error.trpcCode } : {}),
    ...(result.error.status ? { httpStatus: result.error.status } : {}),
  };
  throw error;
}

export function isHubClientAuth(): boolean {
  return getRuntimeConfigSync().authorityMode === 'hub_client';
}

export async function loginToHub(input: {
  email: string;
  password: string;
}): Promise<HubAccessGrant> {
  const api = hubSessionApi();
  if (!api) throw new Error('Store Hub authentication bridge is unavailable');
  return unwrapHubResult(await api.loginHub(input));
}

export async function refreshHubSession(): Promise<HubAccessGrant> {
  const api = hubSessionApi();
  if (!api) throw new Error('Store Hub authentication bridge is unavailable');
  return unwrapHubResult(await api.refreshHub());
}

export async function switchHubStaff(input: {
  targetUserId: string;
  pin: string;
}): Promise<HubAccessGrant> {
  const api = hubSessionApi();
  if (!api) throw new Error('Store Hub authentication bridge is unavailable');
  return unwrapHubResult(await api.switchStaffHub(input));
}

export async function logoutFromHub(): Promise<void> {
  const api = hubSessionApi();
  if (!api) return;
  unwrapHubResult(await api.logoutHub());
}

export async function clearHubSession(): Promise<void> {
  const api = hubSessionApi();
  if (!api) return;
  await api.clearHub();
}
