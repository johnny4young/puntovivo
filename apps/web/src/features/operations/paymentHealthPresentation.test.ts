/**
 * Fase 5.4 / T6 — presentation mappings for the transfer reconciliation
 * subsection. Only the transfer-confirmation tone belongs here: the surface
 * reuses `paymentStatusTone` for outbox rows and never restates it.
 */
import { describe, expect, it } from 'vitest';

import { paymentStatusTone, transferConfirmationTone } from './paymentHealthPresentation';

describe('transferConfirmationTone', () => {
  it('marks the two confirmed verdicts as successful', () => {
    expect(transferConfirmationTone('manual_confirmed')).toBe('success');
    expect(transferConfirmationTone('provider_confirmed')).toBe('success');
  });

  it('marks a rejection as danger and an open balance as warning', () => {
    expect(transferConfirmationTone('rejected')).toBe('danger');
    expect(transferConfirmationTone('needs_reconciliation')).toBe('warning');
  });

  it('keeps pending, reported and missing statuses neutral', () => {
    expect(transferConfirmationTone('pending')).toBe('neutral');
    expect(transferConfirmationTone('customer_reported')).toBe('neutral');
    expect(transferConfirmationTone(null)).toBe('neutral');
  });

  it('does not reuse the outbox status tone for confirmation statuses', () => {
    // `timeout` is a failure for a charge; it is not a transfer verdict at all.
    expect(paymentStatusTone('timeout')).toBe('danger');
    expect(transferConfirmationTone('timeout')).toBe('neutral');
  });
});
