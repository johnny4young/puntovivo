import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon.jsx';
import { buildLeadMailto, buildLeadPayload, getLeadEndpoint, isValidEmail } from '../lib/leads.js';

// A-05 — the waitlist form the high-intent CTAs finally land on.
//
// Renders always (the fallback path still structures the lead into a mailto),
// upgrades transparently to a real POST when the operator configures
// VITE_LEAD_ENDPOINT at build time. The `_gotcha` input is a honeypot: bots
// fill it, humans never see it, and a filled honeypot short-circuits to the
// success state without sending anything.
export function LeadForm({ source = 'contacto', fallbackEmail }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sedes, setSedes] = useState('1');
  const [interest, setInterest] = useState('nube');
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState('idle'); // idle | invalid | sending | sent | error

  const endpoint = getLeadEndpoint(import.meta.env);

  async function handleSubmit(event) {
    event.preventDefault();
    if (honeypot) {
      setState('sent');
      return;
    }
    if (!isValidEmail(email)) {
      setState('invalid');
      return;
    }
    const payload = buildLeadPayload({ email, sedes, interest, source });
    if (!endpoint) {
      window.location.href = buildLeadMailto(fallbackEmail, payload);
      setState('sent');
      return;
    }
    setState('sending');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      setState(response.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="ct-lead-done" data-testid="lead-sent">
        <Icon name="check-circle" size={18} />
        <div>
          <b>{t('contacto.leadForm.sentTitle')}</b>
          <p>{t('contacto.leadForm.sentDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <form className="ct-lead-form" onSubmit={handleSubmit} noValidate>
      <label className="ct-lead-field">
        <span>{t('contacto.leadForm.emailLabel')}</span>
        <input
          type="email"
          value={email}
          placeholder={t('contacto.leadForm.emailPlaceholder')}
          onChange={e => {
            setEmail(e.target.value);
            if (state === 'invalid') setState('idle');
          }}
        />
      </label>
      <div className="ct-lead-row">
        <label className="ct-lead-field">
          <span>{t('contacto.leadForm.sedesLabel')}</span>
          <select value={sedes} onChange={e => setSedes(e.target.value)}>
            <option value="1">{t('contacto.leadForm.sedes1')}</option>
            <option value="2-5">{t('contacto.leadForm.sedes2')}</option>
            <option value="6+">{t('contacto.leadForm.sedes6')}</option>
          </select>
        </label>
        <label className="ct-lead-field">
          <span>{t('contacto.leadForm.interestLabel')}</span>
          <select value={interest} onChange={e => setInterest(e.target.value)}>
            <option value="nube">{t('contacto.leadForm.interestNube')}</option>
            <option value="escritorio">{t('contacto.leadForm.interestEscritorio')}</option>
            <option value="ambas">{t('contacto.leadForm.interestAmbas')}</option>
          </select>
        </label>
      </div>
      {/* Honeypot — visually hidden, never announced. */}
      <input
        type="text"
        value={honeypot}
        onChange={e => setHoneypot(e.target.value)}
        name="_gotcha"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
      />
      {state === 'invalid' && (
        <p className="ct-lead-error" role="alert">
          {t('contacto.leadForm.invalidEmail')}
        </p>
      )}
      {state === 'error' && (
        <p className="ct-lead-error" role="alert">
          {t('contacto.leadForm.sendError')}
        </p>
      )}
      <button className="pv-btn pv-btn-primary" type="submit" disabled={state === 'sending'}>
        <Icon name="mail" size={16} />
        {state === 'sending' ? t('contacto.leadForm.sending') : t('contacto.leadForm.submit')}
      </button>
      <p className="ct-lead-privacy">{t('contacto.leadForm.privacy')}</p>
    </form>
  );
}
