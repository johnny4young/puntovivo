import { createServer } from 'node:http';

export interface FakeS3Upload {
  method: string | undefined;
  url: string | undefined;
  contentType: string | undefined;
  authorization: string | undefined;
  bodyLength: number;
  bodySignature: string;
  bodyText: string | null;
}

export interface FakeS3Provider {
  endpoint: string;
  uploads: FakeS3Upload[];
  close(): Promise<void>;
}

/** ENG-136c — deterministic local S3-compatible PUT target for Electron E2E. */
export async function startFakeS3Provider(): Promise<FakeS3Provider> {
  const uploads: FakeS3Upload[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = request.headers['content-type'];
      uploads.push({
        method: request.method,
        url: request.url,
        contentType,
        authorization: request.headers.authorization,
        bodyLength: body.byteLength,
        bodySignature: body.subarray(0, 4).toString('hex'),
        bodyText: contentType?.startsWith('text/plain') ? body.toString('utf8') : null,
      });
      response.writeHead(200, { etag: '"puntovivo-e2e"' });
      response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Fake S3 provider did not expose a TCP address');
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    uploads,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      }),
  };
}
