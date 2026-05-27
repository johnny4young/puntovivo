import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { render } from '@/test/utils';
import { AnomalyDetailsModal, type AnomalyAlertView } from './AnomalyDetailsModal';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      anomalies: {
        snooze: {
          useMutation: () => ({
            mutate: vi.fn(),
            isPending: false,
            variables: undefined,
          }),
        },
        list: { invalidate: vi.fn() },
      },
    },
    useUtils: () => ({
      ai: {
        anomalies: { list: { invalidate: vi.fn() } },
      },
    }),
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/hooks', () => ({
  useTenantSettings: () => ({
    formatCurrency: (amount: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount),
    formatDateTime: (iso: string) => new Date(iso).toLocaleString('en-US'),
  }),
}));

vi.mock('@/lib/mutationHelpers', () => ({
  onErrorToast: () => () => {},
}));

const alerts: AnomalyAlertView[] = [
  {
    id: 'a1',
    kind: 'refundAmount',
    cashierId: 'c1',
    cashierName: 'Alice',
    severity: 'medium',
    observed: 100,
    baselineMean: 50,
    baselineStdDev: 5,
    distance: 10,
    occurredAt: '2026-05-15T10:00:00Z',
    evidenceRef: null,
  },
  {
    id: 'a2',
    kind: 'voidRate',
    cashierId: 'c2',
    cashierName: 'Bob',
    severity: 'high',
    observed: 200,
    baselineMean: 80,
    baselineStdDev: 12,
    distance: 15,
    occurredAt: '2026-05-15T11:30:00Z',
    evidenceRef: null,
  },
];

describe('AnomalyDetailsModal', () => {
  it('renders both cashier rows when open', () => {
    render(<AnomalyDetailsModal isOpen={true} onClose={vi.fn()} alerts={alerts} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('surfaces per-row snooze buttons via the testid mapping', () => {
    render(<AnomalyDetailsModal isOpen={true} onClose={vi.fn()} alerts={alerts} />);
    expect(screen.getByTestId('anomaly-snooze-a1')).toBeInTheDocument();
    expect(screen.getByTestId('anomaly-snooze-a2')).toBeInTheDocument();
  });

  it('keeps the sort header buttons clickable without throwing', () => {
    render(<AnomalyDetailsModal isOpen={true} onClose={vi.fn()} alerts={alerts} />);
    // Find any button inside a <th> and click it twice — covers both
    // sort directions without depending on locale-specific text.
    const headerButtons = screen
      .getAllByRole('button')
      .filter(btn => btn.closest('th') !== null);
    expect(headerButtons.length).toBeGreaterThan(0);
    // `length > 0` guard above guarantees `[0]`; `!` narrows for
    // `noUncheckedIndexedAccess`. reason: post-length-check invariant.
    fireEvent.click(headerButtons[0]!);
    fireEvent.click(headerButtons[0]!);
  });
});
