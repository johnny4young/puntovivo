import { describe, expect, it } from 'vitest';

import {
  shouldPrintCredentialBanner,
  shouldUseGeneratedAdminPassword,
} from '../logging/credential-banner.js';

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

describe('shouldUseGeneratedAdminPassword', () => {
  it('uses fixed credentials only when every marker explicitly says development/test', () => {
    expect(shouldUseGeneratedAdminPassword({ PUNTOVIVO_RUNTIME_ENV: 'production' })).toBe(true);
    expect(shouldUseGeneratedAdminPassword({ NODE_ENV: 'production' })).toBe(true);
    expect(shouldUseGeneratedAdminPassword({ PUNTOVIVO_RUNTIME_ENV: 'staging' })).toBe(true);
    expect(
      shouldUseGeneratedAdminPassword({
        NODE_ENV: 'production',
        PUNTOVIVO_RUNTIME_ENV: 'development',
      })
    ).toBe(true);
    expect(shouldUseGeneratedAdminPassword({})).toBe(true);
    expect(shouldUseGeneratedAdminPassword({ NODE_ENV: 'development' })).toBe(false);
    expect(
      shouldUseGeneratedAdminPassword({
        NODE_ENV: 'test',
        PUNTOVIVO_RUNTIME_ENV: 'development',
      })
    ).toBe(false);
  });
});
