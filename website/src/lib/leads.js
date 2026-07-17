// A-05 — lead capture logic, kept pure so node --test covers it.
//
// The site's three highest-intent CTAs (demo, "habla con nosotros", "avísame
// cuando salga la nube") all landed on a page with no way to leave contact
// info: the lead evaporated. This module powers the waitlist form with an
// honest degradation path:
//
//   - `VITE_LEAD_ENDPOINT` set at build time → POST JSON (Formspree-compatible)
//   - unset → a structured mailto: the visitor still self-qualifies (email +
//     store count + interest) and the operator receives a parseable email
//     instead of a blank "hola".
//
// Components pass `import.meta.env` in; these functions never read it
// themselves so tests can feed plain objects.

/** Pragmatic email check: something@something.tld, no spaces. */
export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? '').trim());
}

/** POST target for leads, or null when the operator has not configured one. */
export function getLeadEndpoint(env) {
  const raw = env?.VITE_LEAD_ENDPOINT;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^https:\/\//.test(trimmed) ? trimmed : null;
}

/**
 * The normalized lead record. `sedes` and `interest` come from closed
 * selects, but the form is client-side — clamp instead of trusting.
 */
export function buildLeadPayload({ email, sedes, interest, source }) {
  const SEDES = ['1', '2-5', '6+'];
  const INTEREST = ['nube', 'escritorio', 'ambas'];
  return {
    email: String(email ?? '').trim(),
    sedes: SEDES.includes(sedes) ? sedes : SEDES[0],
    interest: INTEREST.includes(interest) ? interest : INTEREST[0],
    source: String(source ?? 'contacto').slice(0, 64),
  };
}

/** mailto: fallback with the lead encoded in subject/body. */
export function buildLeadMailto(to, payload) {
  const subject = `Lista de espera Puntovivo — ${payload.interest} (${payload.sedes} sedes)`;
  const body = [
    `Email: ${payload.email}`,
    `Sedes: ${payload.sedes}`,
    `Interés: ${payload.interest}`,
    `Origen: ${payload.source}`,
  ].join('\n');
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// --- analytics (same env-in pattern) ---------------------------------------

/**
 * Privacy-default analytics: nothing is injected unless the operator sets
 * BOTH the script src (https) and the site domain at build time — the
 * Plausible/Umami deferred-script pattern.
 */
export function getAnalyticsConfig(env) {
  const src = typeof env?.VITE_ANALYTICS_SRC === 'string' ? env.VITE_ANALYTICS_SRC.trim() : '';
  const domain =
    typeof env?.VITE_ANALYTICS_DOMAIN === 'string' ? env.VITE_ANALYTICS_DOMAIN.trim() : '';
  if (!/^https:\/\//.test(src) || domain.length === 0) return null;
  return { src, domain };
}

/** Idempotent runtime injection (client-only; SSG markup stays script-free). */
export function injectAnalytics(env, doc) {
  const config = getAnalyticsConfig(env);
  if (!config || !doc) return false;
  if (doc.querySelector('script[data-pv-analytics]')) return false;
  const script = doc.createElement('script');
  script.defer = true;
  script.src = config.src;
  script.setAttribute('data-domain', config.domain);
  script.setAttribute('data-pv-analytics', 'true');
  doc.head.appendChild(script);
  return true;
}
