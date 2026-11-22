/**
 * Web Push primitives on node:crypto: VAPID (RFC 8292) and aes128gcm message
 * encryption (RFC 8291). The push service relays ciphertext it cannot read.
 *
 * @module services/push/web-push
 */
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto';

export interface VapidKeys {
  /** Uncompressed P-256 point (65 bytes), base64url — the browser's applicationServerKey. */
  publicKey: string;
  /** Private scalar (32 bytes), base64url. */
  privateKey: string;
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

const RECORD_SIZE = 4096;
// Header (86) + tag (16) + delimiter (1) leave room below one 4096-byte record.
const MAX_PUSH_PLAINTEXT_BYTES = 3_000;
const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60;

function b64url(value: Buffer): string {
  return value.toString('base64url');
}

export function decodeBase64Url(value: string, length: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === length ? bytes : null;
}

function pointToJwk(point: Buffer): { kty: 'EC'; crv: 'P-256'; x: string; y: string } {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(point.subarray(1, 33)),
    y: b64url(point.subarray(33, 65)),
  };
}

/** True when the value is a valid uncompressed P-256 public key. */
export function isP256PublicKey(value: string): boolean {
  const point = decodeBase64Url(value, 65);
  if (!point || point[0] !== 0x04) return false;
  try {
    createPublicKey({ key: pointToJwk(point), format: 'jwk' });
    return true;
  } catch {
    return false;
  }
}

export function isValidSubscriptionKeys(keys: PushSubscriptionKeys): boolean {
  return isP256PublicKey(keys.p256dh) && decodeBase64Url(keys.auth, 16) !== null;
}

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');
  return {
    publicKey: b64url(Buffer.concat([Buffer.from([0x04]), x, y])),
    privateKey: jwk.d!,
  };
}

/** `Authorization` header value for one push service origin. */
export function vapidAuthorization(
  endpoint: URL,
  keys: VapidKeys,
  subject: string,
  nowMs: number = Date.now()
): string {
  const point = Buffer.from(keys.publicKey, 'base64url');
  const key = createPrivateKey({
    key: { ...pointToJwk(point), d: keys.privateKey },
    format: 'jwk',
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: endpoint.origin,
        exp: Math.floor(nowMs / 1000) + VAPID_TOKEN_TTL_SECONDS,
        sub: subject,
      })
    )
  );
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
}

/**
 * Encrypt one message for one subscription as a single aes128gcm record.
 * `fixed` pins the salt and sender key for the RFC 8291 test vector only.
 */
export function encryptPushPayload(
  plaintext: Buffer,
  keys: PushSubscriptionKeys,
  fixed: { salt?: Buffer; senderPrivateKey?: Buffer } = {}
): Buffer {
  if (plaintext.length > MAX_PUSH_PLAINTEXT_BYTES) throw new Error('PUSH_PAYLOAD_TOO_LARGE');
  const receiverKey = decodeBase64Url(keys.p256dh, 65);
  const authSecret = decodeBase64Url(keys.auth, 16);
  if (!receiverKey || !authSecret) throw new Error('PUSH_KEYS_INVALID');

  const sender = createECDH('prime256v1');
  let senderKey: Buffer;
  if (fixed.senderPrivateKey) {
    sender.setPrivateKey(fixed.senderPrivateKey);
    senderKey = sender.getPublicKey();
  } else {
    senderKey = sender.generateKeys();
  }
  const sharedSecret = sender.computeSecret(receiverKey);
  const ikm = hkdf(
    sharedSecret,
    authSecret,
    Buffer.concat([Buffer.from('WebPush: info\0'), receiverKey, senderKey]),
    32
  );
  const salt = fixed.salt ?? randomBytes(16);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 marks the last (and only) record, with no padding.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderKey.length, 20);
  return Buffer.concat([header, senderKey, body]);
}
