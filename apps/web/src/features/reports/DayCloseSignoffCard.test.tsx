import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { DayCloseSignoffCard } from './DayCloseSignoffCard';

const readyReport = {
  date: '2026-07-14',
  timeZone: 'America/Bogota',
  currencyCode: 'COP',
  generatedAt: '2026-07-15T02:00:00.000Z',
  window: {
    start: '2026-07-14T05:00:00.000Z',
    endExclusive: '2026-07-15T05:00:00.000Z',
  },
  sales: {
    count: 0,
    subtotal: 0,
    discounts: 0,
    taxes: 0,
    tips: 0,
    serviceCharges: 0,
    grossRevenue: 0,
    refundAmount: 0,
    netRevenue: 0,
  },
  payments: [],
  cash: {
    closedSessions: 0,
    openSessions: 0,
    expected: 0,
    counted: 0,
    overShort: 0,
    balancedSessions: 0,
    discrepancySessions: 0,
  },
  fiscal: {
    total: 0,
    totalAmount: 0,
    byStatus: {
      pending: 0,
      sent: 0,
      accepted: 0,
      rejected: 0,
      contingency: 0,
      voided: 0,
      notified_correction: 0,
      partial_send: 0,
    },
  },
  adjustments: {
    voids: { count: 0, amount: 0 },
    refunds: { count: 0, amount: 0 },
  },
  anomalies: {
    total: 0,
    high: 0,
    medium: 0,
    byKind: { ticketsPerHourSpike: 0, voidRate: 0, refundAmount: 0, noSaleSessions: 0 },
  },
  capabilities: { commissions: 'not_tracked' as const, waste: 'not_tracked' as const },
  readiness: { readyToSign: true, blockers: [], warnings: [] },
};

describe('DayCloseSignoffCard (ENG-141b)', () => {
  it('requires explicit attestation and an irreversible confirmation', async () => {
    const user = userEvent.setup();
    const onSign = vi.fn();
    render(
      <DayCloseSignoffCard
        date="2026-07-14"
        report={readyReport}
        signoff={null}
        isSigning={false}
        onSign={onSign}
      />
    );

    const signButton = screen.getByRole('button', { name: /Firmar cierre|Sign day close/i });
    expect(signButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(signButton).toBeEnabled();
    await user.click(signButton);

    expect(screen.getByRole('dialog')).toHaveTextContent(/irreversible/i);
    expect(onSign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Firmar y proteger|Sign and freeze/i }));
    expect(onSign).toHaveBeenCalledTimes(1);
  });

  it('keeps the attestation disabled while reconciliation is blocked', () => {
    render(
      <DayCloseSignoffCard
        date="2026-07-14"
        report={{
          ...readyReport,
          cash: { ...readyReport.cash, openSessions: 1 },
          readiness: { readyToSign: false, blockers: ['open_sessions'], warnings: [] },
        }}
        signoff={null}
        isSigning={false}
        onSign={vi.fn()}
      />
    );

    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Firmar cierre|Sign day close/i })).toBeDisabled();
    expect(screen.getByTestId('day-close-signoff-card')).toHaveTextContent(
      /bloqueos|blocking items/i
    );
  });

  it('shows immutable signer and hash evidence without another signing action', () => {
    const reportHash = 'b'.repeat(64);
    render(
      <DayCloseSignoffCard
        date="2026-07-14"
        report={readyReport}
        signoff={{
          id: 'signoff-1',
          date: '2026-07-14',
          schemaVersion: 1,
          timeZone: 'America/Bogota',
          currencyCode: 'COP',
          reportHash,
          signedAt: '2026-07-15T03:00:00.000Z',
          signedBy: { id: 'manager-1', name: 'María Manager' },
          report: readyReport,
        }}
        isSigning={false}
        onSign={vi.fn()}
      />
    );

    expect(screen.getByTestId('day-close-signed-evidence')).toHaveTextContent('María Manager');
    expect(screen.getByTestId('day-close-signed-evidence')).toHaveTextContent(reportHash);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Firmar cierre|Sign day close/i })
    ).not.toBeInTheDocument();
  });
});
