/**
 * Sealed storage for the installation's VAPID key pair and each subscription's
 * keys. The wrapping key derives from the database key, which the desktop
 * keeps in the OS keychain; without it push stays off.
 *
 * @module services/push/key-store
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { appSettings } from '../../db/schema.js';
import { generateVapidKeys, type PushSubscriptionKeys, type VapidKeys } from './web-push.js';

const VAPID_SETTING_KEY = 'web_push_vapid';
let wrappingKey: Buffer | null = null;

export function configureWebPushKey(source: string | undefined): void {
  wrappingKey?.fill(0);
  wrappingKey = source
    ? createHash('sha256').update('puntovivo:web-push:v1\0').update(source).digest()
    : null;
}

export function hasWebPushKey(): boolean {
  return wrappingKey !== null;
}

function seal(plain: string, aad: string): string {
  if (!wrappingKey) throw new Error('WEB_PUSH_KEY_UNAVAILABLE');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    ...[iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')),
  ].join('.');
}

function open(sealed: string, aad: string): string {
  if (!wrappingKey) throw new Error('WEB_PUSH_KEY_UNAVAILABLE');
  const [version, iv, tag, encrypted] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('WEB_PUSH_SEALED_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', wrappingKey, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

const vapidAad = 'puntovivo:web-push:vapid:v1';
const subscriptionAad = (endpoint: string) => `puntovivo:web-push:subscription:v1\0${endpoint}`;

export function sealSubscriptionKeys(endpoint: string, keys: PushSubscriptionKeys): string {
  return seal(JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }), subscriptionAad(endpoint));
}

export function openSubscriptionKeys(endpoint: string, sealed: string): PushSubscriptionKeys {
  const parsed = JSON.parse(open(sealed, subscriptionAad(endpoint))) as PushSubscriptionKeys;
  return { p256dh: parsed.p256dh, auth: parsed.auth };
}

interface StoredVapid {
  publicKey: string;
  sealedPrivateKey: string;
}

function isStoredVapid(value: unknown): value is StoredVapid {
  const candidate = value as Partial<StoredVapid> | null;
  return typeof candidate?.publicKey === 'string' && typeof candidate.sealedPrivateKey === 'string';
}

/**
 * The installation's VAPID pair, created on first use. Null when no wrapping
 * key is configured. A pair sealed under a previous database key is replaced:
 * browsers subscribed to it re-subscribe on their next visit.
 */
export function getOrCreateVapidKeys(db: DatabaseInstance): VapidKeys | null {
  if (!wrappingKey) return null;
  return readVapidKeys(db) ?? db.transaction(tx => readVapidKeys(tx) ?? createVapidKeys(tx));
}

function readVapidKeys(db: DatabaseInstance): VapidKeys | null {
  const stored = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, VAPID_SETTING_KEY))
    .get()?.value;
  if (!isStoredVapid(stored)) return null;
  try {
    return { publicKey: stored.publicKey, privateKey: open(stored.sealedPrivateKey, vapidAad) };
  } catch {
    return null;
  }
}

function createVapidKeys(db: DatabaseInstance): VapidKeys {
  const created = generateVapidKeys();
  const value: StoredVapid = {
    publicKey: created.publicKey,
    sealedPrivateKey: seal(created.privateKey, vapidAad),
  };
  db.insert(appSettings)
    .values({ key: VAPID_SETTING_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
    .run();
  return created;
}

/** Public half only, for the browser's applicationServerKey. */
export function getVapidPublicKey(db: DatabaseInstance): string | null {
  return getOrCreateVapidKeys(db)?.publicKey ?? null;
}
