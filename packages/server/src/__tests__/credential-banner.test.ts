import { describe, expect, it } from 'vitest';

import { shouldPrintCredentialBanner } from '../logging/credential-banner.js';

describe('shouldPrintCredentialBanner', () => {
  it('prints by default for an interactive local operator', () => {
    expect(shouldPrintCredentialBanner({})).toBe(true);
  });

  it('suppresses credentials only for the explicit quality-gate flag', () => {
    expect(
      shouldPrintCredentialBanner({
        PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
      })
    ).toBe(false);
    expect(
      shouldPrintCredentialBanner({
        PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'false',
      })
    ).toBe(true);
  });
});
