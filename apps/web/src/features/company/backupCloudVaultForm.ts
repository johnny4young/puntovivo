import type { BackupCloudVaultStatus } from '@/types/electron';

export interface CloudVaultForm {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export const EMPTY_CLOUD_VAULT_FORM: CloudVaultForm = {
  endpoint: '',
  region: 'auto',
  bucket: '',
  prefix: 'puntovivo-backups',
  forcePathStyle: true,
  accessKeyId: '',
  secretAccessKey: '',
};

/** Project redacted main-process status into a write-only credential form. */
export function cloudVaultFormFromStatus(status: BackupCloudVaultStatus): CloudVaultForm {
  return {
    endpoint: status.endpoint ?? '',
    region: status.region ?? 'auto',
    bucket: status.bucket ?? '',
    prefix: status.prefix ?? 'puntovivo-backups',
    forcePathStyle: status.configured ? status.forcePathStyle : true,
    accessKeyId: '',
    secretAccessKey: '',
  };
}
