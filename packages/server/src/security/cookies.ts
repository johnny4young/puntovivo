import type { FastifyRequest } from 'fastify';

// The Secure attribute rides on Fastify's own protocol resolution.
// `request.protocol` honors X-Forwarded-Proto only when the server was
// booted with trustProxy (site_hub behind its reverse proxy — see
// create-server.ts) and ignores it on device_local, where any renderer
// or LAN client could spoof the header. Reading the raw header here
// would bypass that deployment contract.
export function shouldUseSecureCookies(request: Pick<FastifyRequest, 'protocol'>): boolean {
  return request.protocol === 'https';
}
