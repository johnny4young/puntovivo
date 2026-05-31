import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { RefinementCtx } from 'zod';

export const ESC_POS_ALLOWED_TCP_PORTS = [9100, 9101, 9102, 9103] as const;

const ALLOWED_PORTS = new Set<number>(ESC_POS_ALLOWED_TCP_PORTS);
const HOST_FORBIDDEN_CHARS = /[/?#@\\]/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}\.?$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}\.?$/;

interface EscPosTcpConfigLike {
  channel?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
}

export interface ResolvedEscPosTcpTarget {
  host: string;
  family: 4 | 6;
}

export class EscPosTcpTargetPolicyError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EscPosTcpTargetPolicyError';
  }
}

function trimIpv6Zone(value: string): string {
  const index = value.indexOf('%');
  return index === -1 ? value : value.slice(0, index);
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(part => Number.parseInt(part, 10));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index]
    )
  ) {
    return null;
  }
  return octets;
}

function isAllowedPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const a = octets[0]!;
  const b = octets[1]!;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isAllowedUniqueLocalIpv6(address: string): boolean {
  const normalized = trimIpv6Zone(address).toLowerCase();
  if (normalized === '::' || normalized === '::1') {
    return false;
  }
  if (normalized.startsWith('::ffff:')) {
    return isAllowedPrivateIpv4(normalized.slice('::ffff:'.length));
  }
  return normalized.startsWith('fc') || normalized.startsWith('fd');
}

export function isAllowedEscPosTcpAddress(address: string): boolean {
  const normalized = trimIpv6Zone(address.trim());
  const family = isIP(normalized);
  if (family === 4) {
    return isAllowedPrivateIpv4(normalized);
  }
  if (family === 6) {
    return isAllowedUniqueLocalIpv6(normalized);
  }
  return false;
}

function isValidEscPosTcpHost(value: string): boolean {
  const host = value.trim();
  if (host.length === 0 || host.length > 253 || HOST_FORBIDDEN_CHARS.test(host)) {
    return false;
  }
  if (isIP(trimIpv6Zone(host)) !== 0) {
    return true;
  }
  return HOSTNAME_PATTERN.test(host);
}

export function validateEscPosTcpTargetConfig(config: EscPosTcpConfigLike): string[] {
  if (config.channel !== 'tcp') {
    return [];
  }

  const issues: string[] = [];
  const host = config.host?.trim();
  if (!host) {
    issues.push('ESC/POS TCP host is required');
  } else if (!isValidEscPosTcpHost(host)) {
    issues.push('ESC/POS TCP host must be a hostname or IP address, not a URL or path');
  } else if (isIP(trimIpv6Zone(host)) !== 0 && !isAllowedEscPosTcpAddress(host)) {
    issues.push('ESC/POS TCP host must be a private LAN address');
  } else if (host.toLowerCase() === 'localhost') {
    issues.push('ESC/POS TCP host cannot be localhost');
  }

  const port = config.port ?? 9100;
  if (!ALLOWED_PORTS.has(port)) {
    issues.push(
      `ESC/POS TCP port must be one of ${ESC_POS_ALLOWED_TCP_PORTS.join(', ')}`
    );
  }

  return issues;
}

export function addEscPosTcpTargetIssues(
  config: EscPosTcpConfigLike,
  ctx: RefinementCtx
): void {
  for (const message of validateEscPosTcpTargetConfig(config)) {
    ctx.addIssue({
      code: 'custom',
      path: message.includes('port') ? ['port'] : ['host'],
      message,
    });
  }
}

export async function resolveEscPosTcpTarget(
  host: string,
  port: number
): Promise<ResolvedEscPosTcpTarget> {
  const shapeIssues = validateEscPosTcpTargetConfig({ channel: 'tcp', host, port });
  if (shapeIssues.length > 0) {
    throw new EscPosTcpTargetPolicyError(shapeIssues.join('; '), { host, port });
  }

  const literalFamily = isIP(trimIpv6Zone(host));
  if (literalFamily === 4 || literalFamily === 6) {
    return { host: trimIpv6Zone(host), family: literalFamily };
  }

  const addresses = await lookup(host, { all: true, verbatim: false });
  const denied = addresses.filter(address => !isAllowedEscPosTcpAddress(address.address));
  if (addresses.length === 0 || denied.length > 0) {
    throw new EscPosTcpTargetPolicyError(
      'ESC/POS TCP host resolved outside private LAN ranges',
      {
        host,
        port,
        resolvedAddresses: addresses.map(address => address.address),
      }
    );
  }

  const selected = addresses[0]!;
  return {
    host: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}
