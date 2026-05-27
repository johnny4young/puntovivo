import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { FiscalStatusBadge, type FiscalDocumentStatus } from '../FiscalStatusBadge';

const STATUS_LABELS: Record<FiscalDocumentStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  contingency: 'Contingency',
  // ENG-176c — three new statuses added so non-DIAN adapters can
  // express their lifecycle without surrogate columns.
  voided: 'Voided',
  notified_correction: 'Correction notified',
  partial_send: 'Partially sent',
};

describe('FiscalStatusBadge', () => {
  for (const status of Object.keys(STATUS_LABELS) as FiscalDocumentStatus[]) {
    it(`renders the ${status} status with the i18n label`, () => {
      render(<FiscalStatusBadge status={status} />);
      expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
    });
  }

  it('uses the danger variant for rejected', () => {
    render(<FiscalStatusBadge status="rejected" />);
    const badge = screen.getByText(STATUS_LABELS.rejected);
    expect(badge).toHaveClass('bg-danger-50');
  });

  it('uses the warning variant for contingency', () => {
    render(<FiscalStatusBadge status="contingency" />);
    const badge = screen.getByText(STATUS_LABELS.contingency);
    expect(badge).toHaveClass('bg-warning-50');
  });

  it('uses the success variant for accepted', () => {
    render(<FiscalStatusBadge status="accepted" />);
    const badge = screen.getByText(STATUS_LABELS.accepted);
    expect(badge).toHaveClass('bg-success-50');
  });

  it('uses the danger variant for voided (terminal cancellation)', () => {
    render(<FiscalStatusBadge status="voided" />);
    const badge = screen.getByText(STATUS_LABELS.voided);
    expect(badge).toHaveClass('bg-danger-50');
  });

  it('uses the warning variant for notified_correction (action required)', () => {
    render(<FiscalStatusBadge status="notified_correction" />);
    const badge = screen.getByText(STATUS_LABELS.notified_correction);
    expect(badge).toHaveClass('bg-warning-50');
  });

  it('uses the primary variant for partial_send (in-progress lote)', () => {
    render(<FiscalStatusBadge status="partial_send" />);
    const badge = screen.getByText(STATUS_LABELS.partial_send);
    expect(badge).toHaveClass('bg-primary-100');
  });
});
