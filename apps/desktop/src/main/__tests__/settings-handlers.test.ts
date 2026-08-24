import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { handleGatedSettingsUpdate, handleLocaleUpdate } from '../ipc/settings-handlers.ts';

describe('settings-handlers', () => {
  it('gates a settings update on the session BEFORE persisting', async () => {
    const order: string[] = [];
    const result = await handleGatedSettingsUpdate(
      {
        requireTenantId: () => {
          order.push('gate');
          return 'tenant-1';
        },
      },
      async () => {
        order.push('persist');
        return 'saved';
      }
    );
    assert.equal(result, 'saved');
    assert.deepEqual(order, ['gate', 'persist']);
  });

  it('a rejected session never reaches persistence', async () => {
    let persisted = false;
    await assert.rejects(
      () =>
        handleGatedSettingsUpdate(
          {
            requireTenantId: () => {
              throw new Error('SESSION_NOT_REGISTERED');
            },
          },
          async () => {
            persisted = true;
            return 'saved';
          }
        ),
      /SESSION_NOT_REGISTERED/
    );
    assert.equal(persisted, false);
  });

  it('the locale update is exempt from the session gate by design', () => {
    // The handler takes NO session dep at all — the exemption is
    // structural, not a forgotten call. This test pins the pre-login
    // i18n bootstrap contract.
    const applied: string[] = [];
    const result = handleLocaleUpdate(
      {
        normalize: locale => (locale === 'es' ? 'es' : 'en'),
        apply: next => applied.push(next),
      },
      'es'
    );
    assert.equal(result, 'es');
    assert.deepEqual(applied, ['es']);
  });

  it('the locale update normalizes non-string input', () => {
    const result = handleLocaleUpdate(
      {
        normalize: locale => (locale === 'es' ? 'es' : 'en'),
        apply: () => {},
      },
      { hostile: true }
    );
    assert.equal(result, 'en');
  });
});
