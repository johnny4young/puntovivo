import { isAbsolute } from 'node:path';

export const PACKAGED_RECOVERY_MODE_ARGUMENT = '--puntovivo-packaged-recovery-rehearsal';
export const PACKAGED_RECOVERY_ENVIRONMENT_FLAG = 'PUNTOVIVO_PACKAGED_RECOVERY_REHEARSAL';

export interface PackagedRecoveryRequest {
  outputDirectory: string;
  candidateSha: string;
}

function readValue(argv: string[], prefix: string): string | null {
  const argument = argv.find(value => value.startsWith(`${prefix}=`));
  return argument?.slice(prefix.length + 1) ?? null;
}

export function isPackagedRecoveryRequested(argv: string[]): boolean {
  return argv.includes(PACKAGED_RECOVERY_MODE_ARGUMENT);
}

export function parsePackagedRecoveryRequest(input: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
}): PackagedRecoveryRequest | null {
  if (!isPackagedRecoveryRequested(input.argv)) return null;
  if (!input.isPackaged) {
    throw new Error('packaged recovery rehearsal requires a packaged application');
  }
  if (input.env[PACKAGED_RECOVERY_ENVIRONMENT_FLAG] !== '1') {
    throw new Error('packaged recovery rehearsal environment authorization is missing');
  }
  const outputDirectory = readValue(input.argv, '--recovery-output');
  if (!outputDirectory || !isAbsolute(outputDirectory)) {
    throw new Error('packaged recovery rehearsal requires an absolute output directory');
  }
  const candidateSha = readValue(input.argv, '--candidate-sha')?.toLowerCase() ?? '';
  if (!/^[0-9a-f]{40}$/.test(candidateSha)) {
    throw new Error('packaged recovery rehearsal requires a complete candidate SHA');
  }
  return { outputDirectory, candidateSha };
}
