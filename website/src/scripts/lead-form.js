// A-05 — waitlist form behaviour.
//
// Same state machine the React component had (idle → invalid | sending → sent |
// error), driven by toggling markup that is already on the page. The pure parts
// — validation, payload clamping, mailto construction — stay in src/lib/leads.js
// so node --test still covers them.

import { buildLeadMailto, buildLeadPayload, isValidEmail } from '../lib/leads.js';

for (const form of document.querySelectorAll('[data-lead-form]')) {
  const endpoint = form.getAttribute('data-endpoint') || '';
  const source = form.getAttribute('data-source') || 'contacto';
  const fallbackEmail = form.getAttribute('data-fallback-email') || '';
  const submitLabel = form.querySelector('[data-lead-submit-label]');
  const button = form.querySelector('button[type="submit"]');
  const errors = {
    invalid: form.querySelector('[data-lead-error="invalid"]'),
    send: form.querySelector('[data-lead-error="send"]'),
  };
  // The success panel is a sibling of the form, not a child of it.
  const success = form.parentElement?.querySelector('[data-lead-success]');

  function showError(kind) {
    for (const [name, el] of Object.entries(errors)) {
      if (el) el.hidden = name !== kind;
    }
  }

  function clearErrors() {
    for (const el of Object.values(errors)) {
      if (el) el.hidden = true;
    }
  }

  function showSent() {
    if (success) success.hidden = false;
    form.hidden = true;
  }

  function setSending(sending) {
    if (button) button.disabled = sending;
    if (submitLabel) {
      submitLabel.textContent = sending
        ? form.getAttribute('data-label-sending')
        : form.getAttribute('data-label-submit');
    }
  }

  form.querySelector('input[name="email"]')?.addEventListener('input', clearErrors);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);

    // A filled honeypot means a bot: show success and send nothing.
    if (String(data.get('_gotcha') || '')) {
      showSent();
      return;
    }

    const email = String(data.get('email') || '');
    if (!isValidEmail(email)) {
      showError('invalid');
      return;
    }
    clearErrors();

    const payload = buildLeadPayload({
      email,
      sedes: String(data.get('sedes') || ''),
      interest: String(data.get('interest') || ''),
      source,
    });

    if (!endpoint) {
      window.location.href = buildLeadMailto(fallbackEmail, payload);
      showSent();
      return;
    }

    setSending(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) showSent();
      else showError('send');
    } catch {
      showError('send');
    } finally {
      setSending(false);
    }
  });
}
