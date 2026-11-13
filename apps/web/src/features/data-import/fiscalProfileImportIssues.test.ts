import i18next from 'i18next';
import { describe, expect, it } from 'vitest';

import { fiscalProfileIssueText } from './fiscalProfileImportIssues';

describe('fiscalProfileIssueText', () => {
  it('names the expected NIT check digit in en and es', () => {
    const issue = {
      code: 'invalid_check_digit' as const,
      field: 'taxIdentifier' as const,
      expectedDigit: 0,
    };
    expect(fiscalProfileIssueText(i18next.getFixedT('en'), issue)).toBe(
      'The verification digit is wrong; the correct one is 0'
    );
    expect(fiscalProfileIssueText(i18next.getFixedT('es'), issue)).toBe(
      'El dígito de verificación es incorrecto; el correcto es 0'
    );
  });

  it('keeps the generic text for other issues', () => {
    expect(
      fiscalProfileIssueText(i18next.getFixedT('en'), {
        code: 'invalid_tax_identifier',
        field: 'taxIdentifier',
      })
    ).toBe('The issuer tax identifier is not valid for this country');
  });
});
