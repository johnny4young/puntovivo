/** Host that runs the server on the calling thread. */
import { createServer, type PuntovivoServer, type ServerOptions } from '@puntovivo/server';
import type { AuditAnchorStore } from '@puntovivo/server/audit-anchor';
import type { EmbeddedServerHost } from './contract.ts';
import { createServerOperations } from './operations.ts';

export function createInProcessServerHost(server: PuntovivoServer): EmbeddedServerHost {
  return {
    ...createServerOperations(server),
    get url() {
      return server.getUrl();
    },
    close: () => server.close(),
  };
}

/** Launcher for the server lifecycle that keeps the server on this thread. */
export function createInProcessLauncher(deps: {
  prepareAuditAnchorStore: () => Promise<AuditAnchorStore | undefined>;
  createEmbeddedServer?: (options: ServerOptions) => Promise<PuntovivoServer>;
}): (options: ServerOptions) => Promise<EmbeddedServerHost> {
  const create = deps.createEmbeddedServer ?? createServer;
  return async options => {
    const auditAnchorStore = await deps.prepareAuditAnchorStore();
    const server = await create({ ...options, ...(auditAnchorStore ? { auditAnchorStore } : {}) });
    try {
      await server.listen();
    } catch (error) {
      await server.close().catch(() => undefined);
      throw error;
    }
    return createInProcessServerHost(server);
  };
}
