import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveRuntimeConfig } from '@puntovivo/server';

// ENG-072 regression pin. The Authority Node ADR (ADR-0008) keeps
// `device_local` as the default runtime mode and the embedded Electron
// server bound to loopback so a fresh desktop install boots exactly
// like every existing tenant's install before this ticket.
//
// `apps/desktop/src/main/index.ts::startEmbeddedServer` calls
// `resolveRuntimeConfig({ env: process.env })` and pipes the result to
// `createServer({ port, host, runtime })`. These tests pin the
// "no env vars set" outcome so a future refactor cannot silently
// flip the default to `site_hub` or change the bind host.
//
// Run via `npm run test --workspace=@puntovivo/desktop`. Uses
// `node --test --experimental-strip-types`, so the import resolves
// against the built `@puntovivo/server` package (`ci:desktop` always
// builds the server first).
describe('Authority Node default runtime (ENG-072)', () => {
  it('returns device_local + 127.0.0.1 + 8090 when no env vars are set', () => {
    const cfg = resolveRuntimeConfig({ env: {} });
    assert.equal(
      cfg.authorityMode,
      'device_local',
      'authorityMode default must stay `device_local`; flipping it would change every existing install on next boot.'
    );
    assert.equal(
      cfg.bindHost,
      '127.0.0.1',
      'bindHost default must stay loopback; flipping it would expose the embedded server to the LAN without operator consent.'
    );
    assert.equal(
      cfg.bindPort,
      8090,
      'bindPort default must stay 8090; flipping it would break every renderer that hardcodes the loopback URL.'
    );
    assert.equal(cfg.hubUrl, null, 'hubUrl default must stay null in device_local.');
    assert.equal(cfg.siteId, null, 'siteId default must stay null when no env override.');
    assert.equal(cfg.deviceId, null, 'deviceId default must stay null in device_local.');
    assert.deepEqual(
      cfg.allowedLanOrigins,
      [],
      'allowedLanOrigins default must stay empty in device_local; LAN origins are an ENG-073 site_hub concern.'
    );
  });

  it('respects PUNTOVIVO_BIND_PORT override without changing other defaults', () => {
    const cfg = resolveRuntimeConfig({ env: { PUNTOVIVO_BIND_PORT: '9091' } });
    assert.equal(cfg.bindPort, 9091);
    assert.equal(
      cfg.authorityMode,
      'device_local',
      'overriding the port must NOT silently flip the authority mode.'
    );
    assert.equal(cfg.bindHost, '127.0.0.1');
  });

  it('throws on invalid PUNTOVIVO_AUTHORITY_MODE so a bad boot fails fast', () => {
    assert.throws(
      () => resolveRuntimeConfig({ env: { PUNTOVIVO_AUTHORITY_MODE: 'cluster' } }),
      /Invalid PUNTOVIVO_AUTHORITY_MODE/
    );
  });

  it('throws on out-of-range bind port so a typo cannot bind to nowhere', () => {
    assert.throws(
      () => resolveRuntimeConfig({ env: { PUNTOVIVO_BIND_PORT: '70000' } }),
      /Invalid bind port/
    );
  });
});
