import type { FastifyRequest } from 'fastify';

export function shouldUseSecureCookies(
  request: Pick<FastifyRequest, 'headers' | 'protocol'>
): boolean {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const normalizedForwardedProto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto;

  return request.protocol === 'https' || normalizedForwardedProto === 'https';
}
