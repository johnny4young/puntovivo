/** Execute the operator CLI against a real loopback server, without UI or business-data writes. */
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import {
  verifyExternalOrderEnvelope,
  type ExternalOrderSignedEnvelope,
} from '../services/external-orders/signature.js';

const execute = promisify(execFile),
  require = createRequire(import.meta.url),
  cli = fileURLToPath(new URL('../scripts/simulate-external-order.ts', import.meta.url));

it('signs exact event bytes and renews only transport identity on explicit CLI retries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'puntovivo-external-cli-')),
    secret = randomBytes(32).toString('base64url'),
    keyFile = join(directory, 'key'),
    eventFile = join(directory, 'event.json'),
    received: ExternalOrderSignedEnvelope[] = [];
  const body = JSON.stringify({
    schemaVersion: 1,
    eventId: 'cancel-1',
    orderId: 'source-1',
    kind: 'order.cancelled',
    reason: 'Private customer reason',
  });
  let replyStatus = 200;
  let replyBody: string | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const envelope = JSON.parse(
        Buffer.concat(chunks).toString('utf8')
      ) as ExternalOrderSignedEnvelope;
      received.push(envelope);
      response.writeHead(
        request.method === 'POST' &&
          request.url === '/api/trpc/externalOrders.receive' &&
          verifyExternalOrderEnvelope(secret, envelope, Date.now())
          ? replyStatus
          : 401,
        { 'content-type': 'application/json' }
      );
      response.end(
        replyBody ??
          JSON.stringify({
            result: {
              data: {
                eventId: 'cancel-1',
                orderId: 'source-1',
                status: 'cancelled',
                version: 1,
              },
            },
          })
      );
    });
  });
  try {
    await writeFile(keyFile, secret, { mode: 0o600 });
    await writeFile(eventFile, body, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Loopback server has no port');
    const args = [
      '--import',
      require.resolve('tsx'),
      cli,
      '--origin',
      `http://127.0.0.1:${address.port}`,
      '--connector',
      'sandbox-connector',
      '--secret-file',
      keyFile,
      '--event-file',
      eventFile,
    ];
    const result = await execute(process.execPath, [...args, '--repeat', '2', '--fresh-retry']);
    expect(result.stderr).toBe('');
    expect(
      result.stdout
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    ).toEqual([
      { attempt: 1, httpStatus: 200, accepted: true },
      { attempt: 2, httpStatus: 200, accepted: true },
    ]);
    expect(received).toHaveLength(2);
    expect(received.map(envelope => envelope.body)).toEqual([body, body]);
    expect(received[0]!.nonce).not.toBe(received[1]!.nonce);
    for (const envelope of received)
      expect(verifyExternalOrderEnvelope(secret, envelope, Date.now())).toBe(true);
    replyStatus = 409;
    // A wrong endpoint may echo credentials or customer data; the CLI must not log its body.
    replyBody = JSON.stringify({ untrusted: [secret, 'Private customer reason'] });
    await expect(execute(process.execPath, args)).rejects.toMatchObject({
      code: 1,
      stdout: '{"attempt":1,"httpStatus":409,"accepted":false}\n',
      stderr: '',
    });
    expect(received).toHaveLength(3);
    replyStatus = 200;
    for (const badAcknowledgement of [
      { untrusted: [secret, 'Private customer reason'] },
      {
        result: {
          data: { eventId: 'cancel-1', orderId: 'another-order', status: 'cancelled', version: 1 },
        },
      },
    ]) {
      replyBody = JSON.stringify(badAcknowledgement);
      await expect(execute(process.execPath, args)).rejects.toMatchObject({
        code: 1,
        stdout: '{"attempt":1,"httpStatus":200,"accepted":false}\n',
        stderr: '',
      });
    }
    expect(received).toHaveLength(5);
    // Invalid input must fail before making any request, without logging private bytes.
    await writeFile(eventFile, '{private invalid input');
    await expect(execute(process.execPath, args)).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr:
        'Sandbox request failed. Check origin, connector, private key file and event contract; credentials and response bodies are not logged.\n',
    });
    expect(received).toHaveLength(5);
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    await rm(directory, { recursive: true, force: true });
  }
});
