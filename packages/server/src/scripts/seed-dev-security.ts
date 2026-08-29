import { configureAuditAnchorKey } from '../services/audit-anchor.js';

/**
 * Keep audit heads emitted by the developer seed compatible with the server
 * that will reopen the same encrypted database.
 *
 * The standalone and Electron runtimes derive the audit anchor from the
 * SQLCipher key by default. The seed CLI must publish that same process-local
 * key before it creates historical sales; otherwise those writes leave an
 * unanchored head that the next keyed runtime correctly rejects.
 */
export function configureDevSeedAuditAnchor(encryptionKey: string | undefined): () => void {
  configureAuditAnchorKey(encryptionKey);
  return () => configureAuditAnchorKey(undefined);
}
