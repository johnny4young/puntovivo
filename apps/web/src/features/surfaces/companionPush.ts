import { registerCompanionServiceWorker } from './companionPwa';

/** Web Push needs a secure page, a service worker, the Push API and notifications. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current || current.byteLength !== expected.byteLength) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((byte, index) => byte === expected[index]);
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await registerCompanionServiceWorker();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Subscribe this browser to the server's key, replacing a subscription made for another key. */
export async function subscribeBrowser(publicKey: string): Promise<{
  subscription: PushSubscription;
  payload: BrowserPushSubscription;
}> {
  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = base64UrlToBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('PUSH_SUBSCRIPTION_INCOMPLETE');
  return {
    subscription,
    payload: { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
  };
}

/** Stop pushes to this phone before signing out, so a shared phone stops receiving them. */
export async function dropBrowserPush(
  unsubscribe: (endpoint: string) => Promise<unknown>
): Promise<void> {
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    await unsubscribe(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Signing out never waits on push cleanup.
  }
}
