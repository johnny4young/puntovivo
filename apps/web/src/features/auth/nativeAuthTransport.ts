import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import type { HubAuthIpcResult } from '@/types/electron';
import {
  clearHubSession,
  isHubClientAuth,
  loginToHub,
  logoutFromHub,
  refreshHubSession,
  switchHubStaff,
} from './hubAuthTransport';

function localAuth() {
  return getRuntimeConfigSync().authorityMode === 'hub_client'
    ? undefined
    : (window.api?.session ?? window.session)?.localAuth;
}

function requireLocalAuth() {
  const api = localAuth();
  if (!api) throw new Error('Embedded authentication bridge is unavailable');
  return api;
}

export function usesNativeAuthCustody(): boolean {
  return isHubClientAuth() || Boolean(localAuth());
}

function unwrap<T>(result: HubAuthIpcResult<T>): T {
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

export async function loginNative(input: { email: string; password: string }) {
  if (isHubClientAuth()) return loginToHub(input);
  return unwrap(await requireLocalAuth().login(input));
}
export async function refreshNative() {
  if (isHubClientAuth()) return refreshHubSession();
  return unwrap(await requireLocalAuth().refresh());
}
export async function switchStaffNative(input: { targetUserId: string; pin: string }) {
  if (isHubClientAuth()) return switchHubStaff(input);
  return unwrap(await requireLocalAuth().switchStaff(input));
}
export async function logoutNative() {
  if (isHubClientAuth()) return logoutFromHub();
  const api = localAuth();
  if (api) unwrap(await api.logout());
}
export async function clearNative() {
  if (isHubClientAuth()) return clearHubSession();
  await localAuth()?.clear();
}
