import { describe, expect, it } from 'vitest';
import { fiscalIdentifierLabelKey } from './identifierLabel';

describe('fiscalIdentifierLabelKey', () => {
  it('keeps CUFE for the Colombian sales invoice only', () => {
    expect(fiscalIdentifierLabelKey('co', 'FEV')).toBe('receipts:fiscal.cufeLabel');
    for (const kind of ['DEE', 'NC', 'ND']) {
      expect(fiscalIdentifierLabelKey('CO', kind)).toBe('receipts:fiscal.cudeLabel');
    }
  });

  it('uses the Mexican and Chilean identifiers regardless of kind', () => {
    expect(fiscalIdentifierLabelKey('MX', 'DEE')).toBe('receipts:fiscal.uuidLabel');
    expect(fiscalIdentifierLabelKey('CL', 'FEV')).toBe('receipts:fiscal.tedLabel');
  });
});
