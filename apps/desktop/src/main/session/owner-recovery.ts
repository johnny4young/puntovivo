import type { PuntovivoServer } from '@puntovivo/server';
import { isTrustedMainFrame, type MainFrameTrust, type SetupEvent } from './installation-claim.ts';

interface OwnerRecoveryDependencies extends MainFrameTrust {
  getServer: () => Pick<PuntovivoServer, 'localOwnerRecovery'> | null;
}

/** Safe renderer result: only a stable error code ever crosses this boundary. */
export type OwnerRecoveryResult = { ok: true } | { ok: false; errorCode: string };

function errorCodeOf(error: unknown): string {
  const code = (error as { cause?: { errorCode?: unknown } } | null)?.cause?.errorCode;
  return typeof code === 'string' && /^AUTH_[A-Z_]+$/.test(code) ? code : 'INTERNAL_SERVER_ERROR';
}

/**
 * Being at this computer is the proof for owners who never saved a recovery
 * code, so these commands answer only the local main window and call the
 * embedded server in-process; nothing about them is reachable over HTTP.
 */
export function createOwnerRecoveryHandlers(options: OwnerRecoveryDependencies) {
  return {
    status: (event: SetupEvent): { available: boolean } => {
      if (!isTrustedMainFrame(event, options)) return { available: false };
      try {
        return { available: options.getServer()?.localOwnerRecovery.isAvailable() ?? false };
      } catch {
        return { available: false };
      }
    },
    recover: async (event: SetupEvent, input: unknown): Promise<OwnerRecoveryResult> => {
      if (!isTrustedMainFrame(event, options)) {
        return { ok: false, errorCode: 'AUTH_LOCAL_RECOVERY_UNAVAILABLE' };
      }
      const server = options.getServer();
      if (!server) return { ok: false, errorCode: 'AUTH_LOCAL_RECOVERY_UNAVAILABLE' };
      try {
        await server.localOwnerRecovery.recover(input);
        return { ok: true };
      } catch (error) {
        return { ok: false, errorCode: errorCodeOf(error) };
      }
    },
  };
}
