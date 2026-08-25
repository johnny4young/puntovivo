import { beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { handlePrintReceiptRequest, type PrintReceiptHandlerDeps } from '../ipc/print-handler.ts';
import { __resetForTests, SESSION_NOT_REGISTERED } from '../session/desktopSession.ts';
import { registerRole } from './helpers/desktop-session.ts';

function makeDeps(overrides: Partial<PrintReceiptHandlerDeps> = {}): PrintReceiptHandlerDeps & {
  printed: Array<{ html: string; silent: boolean }>;
} {
  const printed: Array<{ html: string; silent: boolean }> = [];
  return {
    printed,
    loadSettings: async () => ({ silent: true, printBackground: false }),
    printReceipt: async (html, settings) => {
      printed.push({ html, silent: settings.silent });
    },
    logError: () => {},
    // Identity stub: assertions read the key itself, pinning WHICH copy
    // the handler picked without coupling the test to locale JSON.
    t: key => key,
    ...overrides,
  };
}

describe('print-receipt IPC handler', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('rejects the hardware actuator before a session is registered', async () => {
    const deps = makeDeps();

    const result = await handlePrintReceiptRequest('<p>ticket</p>', deps);

    assert.deepEqual(result, {
      success: false,
      error: 'print.sessionRequired',
      errorCode: SESSION_NOT_REGISTERED,
    });
    assert.equal(deps.printed.length, 0);
  });

  it('prints the sanitised document once a session is registered', async () => {
    await registerRole('cashier');
    const deps = makeDeps();

    const result = await handlePrintReceiptRequest('<p>ticket</p><script>alert(1)</script>', deps);

    assert.deepEqual(result, { success: true });
    assert.equal(deps.printed.length, 1);
    assert.match(deps.printed[0]!.html, /<p>ticket<\/p>/);
    // The sanitizer's CSP meta legitimately contains the substring
    // script-src, so pin the absence of executable constructs instead.
    assert.doesNotMatch(deps.printed[0]!.html, /<script|alert\(/i);
    assert.equal(deps.printed[0]!.silent, true);
  });

  it('refuses a blank document without touching the print pipeline', async () => {
    await registerRole('cashier');
    const deps = makeDeps();

    const result = await handlePrintReceiptRequest('   ', deps);

    assert.deepEqual(result, { success: false, error: 'print.documentRequired' });
    assert.equal(deps.printed.length, 0);
  });

  it('maps print pipeline failures to a result instead of throwing across IPC', async () => {
    await registerRole('cashier');
    const errors: unknown[] = [];
    const deps = makeDeps({
      printReceipt: async () => {
        throw new Error('spooler unavailable');
      },
      logError: error => errors.push(error),
    });

    const result = await handlePrintReceiptRequest('<p>ticket</p>', deps);

    assert.deepEqual(result, { success: false, error: 'spooler unavailable' });
    assert.equal(errors.length, 1);
  });
});
