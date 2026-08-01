import { request } from 'node:https';
import { isIP } from 'node:net';

export interface WebhookPostRequest {
  url: URL;
  pinnedAddress: { address: string; family: number };
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export type WebhookTransport = (request: WebhookPostRequest) => Promise<{ status: number }>;

/**
 * HTTPS transport with DNS pinning. The hostname is retained for TLS SNI and
 * certificate validation, while the socket lookup is forced to the public IP
 * that passed the destination policy immediately before this call.
 */
export const postPinnedWebhook: WebhookTransport = args =>
  new Promise((resolve, reject) => {
    const hostname = args.url.hostname.replace(/^\[|\]$/g, '');
    const req = request(
      args.url,
      {
        method: 'POST',
        headers: { ...args.headers, 'content-length': Buffer.byteLength(args.body).toString() },
        ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
        lookup(_hostname, options, callback) {
          if (options.all) {
            callback(null, [args.pinnedAddress]);
            return;
          }
          callback(null, args.pinnedAddress.address, args.pinnedAddress.family);
        },
      },
      response => {
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      }
    );
    req.setTimeout(args.timeoutMs, () => {
      req.destroy(new Error('WEBHOOK_DELIVERY_TIMEOUT'));
    });
    req.once('error', reject);
    req.end(args.body);
  });
