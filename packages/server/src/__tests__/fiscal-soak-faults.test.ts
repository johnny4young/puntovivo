import { describe, expect, it } from 'vitest';
import { FiscalProviderError } from '../services/fiscal/errors.js';
import { applySoakFiscalFaults } from '../services/fiscal/packs/co/soak-faults.js';

describe('soak fiscal faults', () => {
  it('does nothing outside a soak run, whatever the other variables say', async () => {
    for (let call = 0; call < 6; call += 1) {
      await expect(
        applySoakFiscalFaults({ PUNTOVIVO_SOAK_FISCAL_FAIL_EVERY: '1' })
      ).resolves.toBeUndefined();
    }
  });

  it('fails every Nth emission with a recoverable provider error', async () => {
    const env = { PUNTOVIVO_SOAK: '1', PUNTOVIVO_SOAK_FISCAL_FAIL_EVERY: '3' };
    const outcomes: string[] = [];
    for (let call = 0; call < 6; call += 1) {
      outcomes.push(
        await applySoakFiscalFaults(env).then(
          () => 'ok',
          error => (error instanceof FiscalProviderError ? error.normalizedKind : 'other')
        )
      );
    }
    expect(outcomes.filter(outcome => outcome === 'PROVIDER_5XX')).toHaveLength(2);
    expect(outcomes.filter(outcome => outcome === 'ok')).toHaveLength(4);
  });

  it('adds the configured latency', async () => {
    const startedAt = Date.now();
    await applySoakFiscalFaults({ PUNTOVIVO_SOAK: '1', PUNTOVIVO_SOAK_FISCAL_LATENCY_MS: '60' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
  });
});
