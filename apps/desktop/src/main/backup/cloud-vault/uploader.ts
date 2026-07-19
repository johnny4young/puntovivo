import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { BackupCloudUploadRequest } from './contracts.ts';

const CLOUD_CONNECTION_TIMEOUT_MS = 10_000;
const CLOUD_REQUEST_TIMEOUT_MS = 120_000;

export async function uploadBackupCloudObject(request: BackupCloudUploadRequest): Promise<void> {
  const { config } = request;
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // The Smithy Node handler defaults requestTimeout to 0. Bound both phases
    // so an unreachable provider cannot leave the scheduler locked forever.
    requestHandler: {
      connectionTimeout: CLOUD_CONNECTION_TIMEOUT_MS,
      requestTimeout: CLOUD_REQUEST_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
  });

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: request.objectKey,
        Body: request.body,
        ContentLength: request.contentLength,
        ContentType: request.contentType,
      })
    );
  } finally {
    client.destroy();
  }
}
