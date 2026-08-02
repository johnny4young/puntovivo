import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import {
  PACKAGED_RECOVERY_ENVIRONMENT_FLAG,
  PACKAGED_RECOVERY_MODE_ARGUMENT,
  isPackagedRecoveryRequested,
  parsePackagedRecoveryRequest,
} from '../packaged-recovery/mode.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('packaged recovery mode request', () => {
  it('stays dormant during ordinary application startup', () => {
    assert.equal(isPackagedRecoveryRequested(['puntovivo']), false);
    assert.equal(
      parsePackagedRecoveryRequest({ argv: ['puntovivo'], env: {}, isPackaged: true }),
      null
    );
  });

  it('accepts an explicitly authorized packaged request with bounded arguments', () => {
    const outputDirectory = resolve('/tmp/puntovivo-recovery-evidence');
    const request = parsePackagedRecoveryRequest({
      argv: [
        'puntovivo',
        PACKAGED_RECOVERY_MODE_ARGUMENT,
        `--recovery-output=${outputDirectory}`,
        `--candidate-sha=${SHA.toUpperCase()}`,
      ],
      env: { [PACKAGED_RECOVERY_ENVIRONMENT_FLAG]: '1' },
      isPackaged: true,
    });
    assert.deepEqual(request, { outputDirectory, candidateSha: SHA });
  });

  it('fails closed for development, missing authorization, relative output, or mutable refs', () => {
    const baseArgs = [
      'puntovivo',
      PACKAGED_RECOVERY_MODE_ARGUMENT,
      `--recovery-output=${resolve('/tmp/puntovivo-recovery-evidence')}`,
      `--candidate-sha=${SHA}`,
    ];
    assert.throws(
      () =>
        parsePackagedRecoveryRequest({
          argv: baseArgs,
          env: { [PACKAGED_RECOVERY_ENVIRONMENT_FLAG]: '1' },
          isPackaged: false,
        }),
      /requires a packaged application/
    );
    assert.throws(
      () => parsePackagedRecoveryRequest({ argv: baseArgs, env: {}, isPackaged: true }),
      /authorization is missing/
    );
    assert.throws(
      () =>
        parsePackagedRecoveryRequest({
          argv: baseArgs.map(value =>
            value.startsWith('--recovery-output=') ? '--recovery-output=relative' : value
          ),
          env: { [PACKAGED_RECOVERY_ENVIRONMENT_FLAG]: '1' },
          isPackaged: true,
        }),
      /absolute output directory/
    );
    assert.throws(
      () =>
        parsePackagedRecoveryRequest({
          argv: baseArgs.map(value =>
            value.startsWith('--candidate-sha=') ? '--candidate-sha=main' : value
          ),
          env: { [PACKAGED_RECOVERY_ENVIRONMENT_FLAG]: '1' },
          isPackaged: true,
        }),
      /complete candidate SHA/
    );
  });
});
