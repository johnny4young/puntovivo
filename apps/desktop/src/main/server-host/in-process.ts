/** Host that runs the server on the calling thread. */
import type { PuntovivoServer } from '@puntovivo/server';
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
