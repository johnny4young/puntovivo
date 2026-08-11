import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

let masterKey: Buffer | null = null;

export function configureWebhookSecretKey(source: string | undefined): void {
  masterKey = source
    ? createHash('sha256').update('puntovivo:webhook-secret:v1').update(source).digest()
    : null;
}

export function hasWebhookSecretKey(): boolean {
  return masterKey !== null;
}

export function createWebhookSigningSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function sealWebhookSecret(secret: string): string {
  if (!masterKey) throw new Error('WEBHOOK_SECRET_KEY_UNAVAILABLE');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function openWebhookSecret(sealed: string): string {
  if (!masterKey) throw new Error('WEBHOOK_SECRET_KEY_UNAVAILABLE');
  const [version, ivValue, tagValue, encryptedValue] = sealed.split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw new Error('WEBHOOK_SECRET_INVALID');
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex')}`;
}
