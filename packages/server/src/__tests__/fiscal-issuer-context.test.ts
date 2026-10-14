/**
 * Issuer facts the fiscal hash reads from tenant settings, the fiscal
 * secrets that never reach a persisted payload, and the wall-clock
 * emission timestamp DIAN expects.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveFiscalHashEnvironment,
  resolveFiscalIssuerTaxId,
  withLiveFiscalSecrets,
  withoutFiscalSecrets,
} from '../services/fiscal/issuer-context.js';
import { splitIssueTimestamp } from '../services/fiscal/orchestrator/helpers.js';

const CO_SETTINGS = {
  fiscal_dian_enabled: true,
  fiscal: {
    co: { nit: '900.373.115-3', softwareId: 'sw-1', softwarePin: '12301' },
    mx: { rfc: 'AAA010101AAA' },
  },
};

describe('resolveFiscalIssuerTaxId', () => {
  it('hashes the Colombian NIT digits without the verification digit', () => {
    expect(resolveFiscalIssuerTaxId('co', CO_SETTINGS, 'tenant-1')).toBe('900373115');
  });

  it('falls back when the NIT is missing or fails the DV check', () => {
    expect(resolveFiscalIssuerTaxId('CO', {}, 'tenant-1')).toBe('tenant-1');
    expect(
      resolveFiscalIssuerTaxId('CO', { fiscal: { co: { nit: '900373115-9' } } }, 'tenant-1')
    ).toBe('tenant-1');
  });

  it('reads the Mexican RFC and leaves unknown countries on the fallback', () => {
    expect(resolveFiscalIssuerTaxId('MX', CO_SETTINGS, 'tenant-1')).toBe('AAA010101AAA');
    expect(resolveFiscalIssuerTaxId('US', CO_SETTINGS, 'tenant-1')).toBe('tenant-1');
  });
});

describe('resolveFiscalHashEnvironment', () => {
  it('maps the Colombian environment to the DIAN TipoAmbiente', () => {
    expect(
      resolveFiscalHashEnvironment('CO', { fiscal: { co: { environment: 'produccion' } } })
    ).toBe('1');
    expect(
      resolveFiscalHashEnvironment('CO', { fiscal: { co: { environment: 'habilitacion' } } })
    ).toBe('2');
    expect(resolveFiscalHashEnvironment('CO', {})).toBe('2');
    expect(
      resolveFiscalHashEnvironment('MX', { fiscal: { co: { environment: 'produccion' } } })
    ).toBe('2');
  });
});

describe('fiscal secrets', () => {
  it('strips the software PIN and keeps every other setting', () => {
    const stripped = withoutFiscalSecrets(CO_SETTINGS);
    expect(stripped).toEqual({
      fiscal_dian_enabled: true,
      fiscal: {
        co: { nit: '900.373.115-3', softwareId: 'sw-1' },
        mx: { rfc: 'AAA010101AAA' },
      },
    });
    expect(CO_SETTINGS.fiscal.co.softwarePin).toBe('12301');
  });

  it('returns the same blob when there is nothing to strip', () => {
    const settings = { fiscal: { mx: { rfc: 'AAA010101AAA' } } };
    expect(withoutFiscalSecrets(settings)).toBe(settings);
  });

  it('re-attaches the live PIN only to a snapshot that carries the branch', () => {
    const frozen = withoutFiscalSecrets(CO_SETTINGS);
    const live = { fiscal: { co: { softwarePin: '99999' } } };
    expect(withLiveFiscalSecrets(frozen, live)).toMatchObject({
      fiscal: { co: { nit: '900.373.115-3', softwarePin: '99999' } },
    });
    expect(withLiveFiscalSecrets({ fiscal: { mx: {} } }, live)).toEqual({ fiscal: { mx: {} } });
    expect(withLiveFiscalSecrets(undefined, live)).toBeUndefined();
  });
});

describe('splitIssueTimestamp', () => {
  const instant = new Date('2026-10-14T03:30:15.789Z');

  it('renders Colombian legal time with its offset, rolling the date back', () => {
    expect(splitIssueTimestamp(instant, 'America/Bogota')).toEqual({
      issueDate: '2026-10-13',
      issueTime: '22:30:15-05:00',
    });
  });

  it('handles positive and fractional offsets', () => {
    expect(splitIssueTimestamp(instant, 'Asia/Kolkata')).toEqual({
      issueDate: '2026-10-14',
      issueTime: '09:00:15+05:30',
    });
  });

  it('falls back to UTC for a missing or unknown timezone', () => {
    const utc = { issueDate: '2026-10-14', issueTime: '03:30:15Z' };
    expect(splitIssueTimestamp(instant)).toEqual(utc);
    expect(splitIssueTimestamp(instant, 'Not/AZone')).toEqual(utc);
  });
});
