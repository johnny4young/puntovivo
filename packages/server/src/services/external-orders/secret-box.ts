/** Connector credentials are sealed separately from webhook secrets and bound to their owner. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
let key: Buffer | null = null;
/** A credential cannot be moved between tenants or connectors, even within the same database. */
export interface ExternalSecretContext {
  tenantId: string;
  connectorId: string;
}
export function configureExternalOrderSecretKey(source: string | undefined): void {
  key?.fill(0);
  key = source
    ? createHash('sha256').update('puntovivo:external-order:secret:v1\0').update(source).digest()
    : null;
}
export function hasExternalOrderSecretKey(): boolean {
  return key !== null;
}
function aad(ctx: ExternalSecretContext): Buffer {
  if (!ctx.tenantId || !ctx.connectorId) throw new Error('EXTERNAL_SECRET_CONTEXT_INVALID');
  return Buffer.from(
    JSON.stringify(['puntovivo:external-order:secret:v1', ctx.tenantId, ctx.connectorId])
  );
}
function decode(value: string, length: number): Buffer {
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value)
    throw new Error('EXTERNAL_SECRET_INVALID');
  return bytes;
}
export function sealExternalOrderSecret(secret: string, ctx: ExternalSecretContext): string {
  if (!key) throw new Error('EXTERNAL_SECRET_KEY_UNAVAILABLE');
  decode(secret, 32);
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(ctx));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function openExternalOrderSecret(sealed: string, ctx: ExternalSecretContext): string {
  if (!key) throw new Error('EXTERNAL_SECRET_KEY_UNAVAILABLE');
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('EXTERNAL_SECRET_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, decode(parts[1]!, 12));
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(decode(parts[2]!, 16));
  const plain = Buffer.concat([decipher.update(decode(parts[3]!, 43)), decipher.final()]);
  try {
    const secret = plain.toString('utf8');
    decode(secret, 32);
    return secret;
  } finally {
    plain.fill(0);
  }
}
