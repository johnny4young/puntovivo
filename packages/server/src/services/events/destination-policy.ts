import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type WebhookAddressResolver = (
  hostname: string
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const defaultResolver: WebhookAddressResolver = hostname =>
  lookup(hostname, { all: true, verbatim: true });

export function parseWebhookDestination(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('WEBHOOK_DESTINATION_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== ''
  ) {
    throw new Error('WEBHOOK_DESTINATION_HTTPS_REQUIRED');
  }
  const hostname = normalizeHostname(url.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('WEBHOOK_DESTINATION_PRIVATE');
  }
  return url;
}

export async function assertPublicWebhookDestination(
  value: string,
  resolver: WebhookAddressResolver = defaultResolver
): Promise<URL> {
  return (await resolvePublicWebhookDestination(value, resolver)).url;
}

export async function resolvePublicWebhookDestination(
  value: string,
  resolver: WebhookAddressResolver = defaultResolver
): Promise<{ url: URL; addresses: ReadonlyArray<{ address: string; family: number }> }> {
  const url = parseWebhookDestination(value);
  const hostname = normalizeHostname(url.hostname);
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolver(hostname);
  if (addresses.length === 0 || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('WEBHOOK_DESTINATION_PRIVATE');
  }
  return { url, addresses };
}

export function isPrivateAddress(value: string): boolean {
  const address = normalizeHostname(value).split('%')[0] ?? '';
  if (address.includes(':')) {
    const mapped = mappedIpv4FromIpv6(address);
    if (mapped) return isPrivateIpv4(mapped);
    if (
      address === '::' ||
      address === '::1' ||
      address.startsWith('::') ||
      address.startsWith('fc') ||
      address.startsWith('fd') ||
      address.startsWith('fe') ||
      address.startsWith('ff') ||
      address.startsWith('64:ff9b:') ||
      address.startsWith('100:') ||
      isIetfSpecialIpv6(address) ||
      address.startsWith('2002:') ||
      address.startsWith('2001:db8:') ||
      address === '2001:db8::'
    ) {
      return true;
    }
    return false;
  }
  return isPrivateIpv4(address);
}

function isIetfSpecialIpv6(address: string): boolean {
  const [first, second = '0'] = address.split(':');
  return first === '2001' && Number.parseInt(second || '0', 16) <= 0x01ff;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0, c = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function normalizeHostname(value: string): string {
  const hostname = value.toLowerCase().replace(/\.$/, '');
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function mappedIpv4FromIpv6(address: string): string | null {
  const suffix = address.match(/^::ffff:(.+)$/)?.[1];
  if (!suffix) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return suffix;
  const [high, low, ...rest] = suffix.split(':');
  if (
    !high ||
    !low ||
    rest.length > 0 ||
    !/^[0-9a-f]{1,4}$/.test(high) ||
    !/^[0-9a-f]{1,4}$/.test(low)
  ) {
    return null;
  }
  const value = Number.parseInt(high, 16) * 65_536 + Number.parseInt(low, 16);
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}
