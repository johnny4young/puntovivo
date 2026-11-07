/** Host that runs the server on the calling thread. */
import type { PuntovivoServer } from '@puntovivo/server';
import type { EmbeddedServerHost } from './contract.ts';
import { setHostedServer } from './hosted-server.ts';
import { createServerOperations } from './operations.ts';

export function createInProcessServerHost(server: PuntovivoServer): EmbeddedServerHost {
  setHostedServer(server);
  return {
    ...createServerOperations(server),
    get url() {
      return server.getUrl();
    },
    async close() {
      try {
        await server.close();
      } finally {
        setHostedServer(null);
      }
    },
  };
}
