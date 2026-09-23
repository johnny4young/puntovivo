import { expect, test } from '@playwright/test';
import { describeEmptyInstallationForwardingFailure } from './support/empty-installation-diagnostics.js';

test('empty-installation forwarding failure records process state without request secrets', () => {
  const diagnostic = describeEmptyInstallationForwardingFailure({
    method: 'POST',
    requestUrl:
      'http://127.0.0.1:50829/api/trpc/observability.reportWebVital?input=private-transcript',
    error: new Error('route.fetch: read ECONNRESET; cookie: secret-refresh-token'),
    childExitCode: null,
    childSignalCode: null,
    childConnected: true,
    stderrBytes: 84,
  });

  expect(diagnostic).toContain('POST observability.reportWebVital');
  expect(diagnostic).toContain('transport=ECONNRESET');
  expect(diagnostic).toContain('childExit=running');
  expect(diagnostic).toContain('childConnected=true');
  expect(diagnostic).toContain('stderrBytes=84');
  expect(diagnostic).not.toContain('private-transcript');
  expect(diagnostic).not.toContain('secret-refresh-token');
  expect(diagnostic).not.toContain('cookie:');
});

test('empty-installation forwarding failure preserves a child crash without echoing unknown input', () => {
  const diagnostic = describeEmptyInstallationForwardingFailure({
    method: 'INVALID secret-method',
    requestUrl: 'not a URL with secret-input',
    error: new Error('unknown failure with secret-error-body'),
    childExitCode: 137,
    childSignalCode: 'SIGKILL',
    childConnected: false,
    stderrBytes: 4096,
  });

  expect(diagnostic).toContain('OTHER other-api');
  expect(diagnostic).toContain('transport=unknown');
  expect(diagnostic).toContain('childExit=137');
  expect(diagnostic).toContain('childSignal=SIGKILL');
  expect(diagnostic).toContain('childConnected=false');
  expect(diagnostic).not.toContain('secret-');
});
