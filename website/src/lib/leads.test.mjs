// A-05 — pins the lead-capture and analytics gating contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadMailto,
  buildLeadPayload,
  getAnalyticsConfig,
  getLeadEndpoint,
  isValidEmail,
} from './leads.js';

test('email validation accepts real shapes and rejects junk', () => {
  assert.ok(isValidEmail('dona.rosa@tienda.co'));
  assert.ok(isValidEmail('  padded@mail.com  '));
  for (const bad of ['', 'a@b', 'sin-arroba.com', 'dos @espacios.co', null, undefined]) {
    assert.equal(isValidEmail(bad), false, `should reject ${String(bad)}`);
  }
});

test('lead endpoint requires an explicit https URL', () => {
  assert.equal(getLeadEndpoint({}), null);
  assert.equal(getLeadEndpoint({ VITE_LEAD_ENDPOINT: '' }), null);
  assert.equal(getLeadEndpoint({ VITE_LEAD_ENDPOINT: 'http://insecure.co/x' }), null);
  assert.equal(
    getLeadEndpoint({ VITE_LEAD_ENDPOINT: ' https://formspree.io/f/abc ' }),
    'https://formspree.io/f/abc'
  );
});

test('payload clamps open values to the closed sets', () => {
  const p = buildLeadPayload({ email: ' x@y.co ', sedes: '999', interest: 'hack', source: 'nube-card' });
  assert.deepEqual(p, { email: 'x@y.co', sedes: '1', interest: 'nube', source: 'nube-card' });
  const ok = buildLeadPayload({ email: 'a@b.co', sedes: '2-5', interest: 'ambas', source: 'contacto' });
  assert.equal(ok.sedes, '2-5');
  assert.equal(ok.interest, 'ambas');
});

test('mailto fallback encodes the lead into subject and body', () => {
  const url = buildLeadMailto('leads@pv.co', buildLeadPayload({ email: 'a@b.co', sedes: '6+', interest: 'nube', source: 'contacto' }));
  assert.ok(url.startsWith('mailto:leads@pv.co?subject='));
  assert.ok(url.includes(encodeURIComponent('6+ sedes')));
  assert.ok(url.includes(encodeURIComponent('Email: a@b.co')));
});

test('analytics stays OFF unless src (https) AND domain are both set', () => {
  assert.equal(getAnalyticsConfig({}), null);
  assert.equal(getAnalyticsConfig({ VITE_ANALYTICS_SRC: 'https://p.io/js/script.js' }), null);
  assert.equal(
    getAnalyticsConfig({ VITE_ANALYTICS_SRC: 'http://p.io/js/s.js', VITE_ANALYTICS_DOMAIN: 'puntovivo.app' }),
    null
  );
  assert.deepEqual(
    getAnalyticsConfig({ VITE_ANALYTICS_SRC: 'https://p.io/js/script.js', VITE_ANALYTICS_DOMAIN: 'puntovivo.app' }),
    { src: 'https://p.io/js/script.js', domain: 'puntovivo.app' }
  );
});
