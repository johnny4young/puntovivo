import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  buildRendererContentSecurityPolicy,
  isFastifyApiResponse,
} from '../renderer-security-headers.ts';

const defaultRuntime = {
  bindHost: '127.0.0.1',
  bindPort: 8090,
  hubUrl: null,
};

describe('renderer security headers (ENG-166)', () => {
  it('allows the default loopback API and Vite websocket origins', () => {
    const csp = buildRendererContentSecurityPolicy({
      isPackagedBuild: false,
      runtime: defaultRuntime,
      webDevServerUrl: 'http://localhost:3000',
    });

    assert.match(csp, /connect-src[^;]*http:\/\/localhost:8090/);
    assert.match(csp, /connect-src[^;]*http:\/\/127\.0\.0\.1:8090/);
    assert.match(csp, /connect-src[^;]*ws:\/\/localhost:3000/);
    assert.match(csp, /script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:/);
  });

  it('uses the runtime bind port when operators override the embedded server port', () => {
    const runtime = { ...defaultRuntime, bindPort: 9091 };
    const csp = buildRendererContentSecurityPolicy({
      isPackagedBuild: true,
      runtime,
      webDevServerUrl: 'http://localhost:3000',
    });

    assert.match(csp, /connect-src[^;]*http:\/\/localhost:9091/);
    assert.equal(isFastifyApiResponse('http://127.0.0.1:9091/api/health', runtime), true);
    assert.equal(isFastifyApiResponse('http://127.0.0.1:8090/api/health', runtime), false);
  });

  it('allows and skips the configured hub origin for packaged hub_client terminals', () => {
    const runtime = {
      bindHost: '127.0.0.1',
      bindPort: 8090,
      hubUrl: 'http://hub.tienda.local:8090',
    };
    const csp = buildRendererContentSecurityPolicy({
      isPackagedBuild: true,
      runtime,
      webDevServerUrl: 'http://localhost:3000',
    });

    assert.match(csp, /connect-src[^;]*http:\/\/hub\.tienda\.local:8090/);
    assert.match(csp, /script-src 'self' blob:/);
    assert.equal(
      isFastifyApiResponse('http://hub.tienda.local:8090/api/trpc/auth.me', runtime),
      true
    );
    assert.equal(
      isFastifyApiResponse('http://hub.tienda.local:8090/dashboard', runtime),
      false
    );
  });
});
