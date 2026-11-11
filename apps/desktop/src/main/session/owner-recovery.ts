import type { EmbeddedServerHost, OwnerRecoveryResult } from '../server-host/contract.ts';
import { isTrustedMainFrame, type MainFrameTrust, type SetupEvent } from './installation-claim.ts';

interface OwnerRecoveryDependencies extends MainFrameTrust {
  getServerHost: () => Pick<EmbeddedServerHost, 'isOwnerRecoveryAvailable' | 'recoverOwner'> | null;
}

export type { OwnerRecoveryResult };

/**
 * Being at this computer is the proof for owners who never saved a recovery
 * code, so these commands answer only the local main window and reach the
 * embedded server through its host; nothing about them is reachable over HTTP.
 */
export function createOwnerRecoveryHandlers(options: OwnerRecoveryDependencies) {
  return {
    status: async (event: SetupEvent): Promise<{ available: boolean }> => {
      if (!isTrustedMainFrame(event, options)) return { available: false };
      try {
        return { available: (await options.getServerHost()?.isOwnerRecoveryAvailable()) ?? false };
      } catch {
        return { available: false };
      }
    },
    recover: async (event: SetupEvent, input: unknown): Promise<OwnerRecoveryResult> => {
      if (!isTrustedMainFrame(event, options)) {
        return { ok: false, errorCode: 'AUTH_LOCAL_RECOVERY_UNAVAILABLE' };
      }
      const host = options.getServerHost();
      if (!host) return { ok: false, errorCode: 'AUTH_LOCAL_RECOVERY_UNAVAILABLE' };
      try {
        return await host.recoverOwner(input);
      } catch {
        return { ok: false, errorCode: 'INTERNAL_SERVER_ERROR' };
      }
    },
  };
}
