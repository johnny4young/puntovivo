/**
 * ENG-038 — Tests for Operations Center Payment Health panel.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { PaymentHealthPanel } from './PaymentHealthPanel';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    payments: {
      reconciliation: {
        useQuery: () => ({
          data: {
            summary: {
              windowDays: 30,
              tendersScanned: 2,
              outboxRows: 2,
              matched: 1,
              mismatches: 2,
              missingProviderReferences: 1,
              providerIssues: 1,
              totalTenderAmount: 180_000,
              unmatchedAmount: 90_000,
            },
            byRail: [
              { railId: 'wompi', outboxRows: 1, amount: 90_000, issues: 1 },
              { railId: 'bold', outboxRows: 0, amount: 0, issues: 0 },
            ],
            mismatches: [
              {
                type: 'missing_provider_reference',
                railId: null,
                salePaymentId: 'sale-payment-1',
                paymentOutboxId: null,
                reference: 'AUTH-MISSING',
                providerTransactionId: null,
                amount: 90_000,
                providerAmount: null,
                status: null,
                createdAt: '2026-05-10T10:00:00.000Z',
                suggestedAction: 'queue_charge',
              },
              {
                type: 'provider_issue',
                railId: 'wompi',
                salePaymentId: 'sale-payment-2',
                paymentOutboxId: 'payment-outbox-1',
                reference: 'AUTH-DECLINED',
                providerTransactionId: 'wompi_tx_1',
                amount: 90_000,
                providerAmount: 90_000,
                status: 'declined',
                createdAt: '2026-05-10T10:30:00.000Z',
                suggestedAction: 'review_provider',
              },
            ],
          },
          isLoading: false,
          error: null,
        }),
      },
      peekOutbox: {
        useQuery: () => ({
          data: [
            {
              id: 'payment-outbox-1',
              railId: 'wompi',
              kind: 'charge',
              status: 'declined',
              salePaymentId: 'sale-payment-2',
              amount: 90_000,
              currencyCode: 'COP',
              reference: 'AUTH-DECLINED',
              providerTransactionId: 'wompi_tx_1',
              payloadVersion: 1,
              attempts: 1,
              nextRetryAt: null,
              lastError: { message: 'Provider declined' },
              priority: 0,
              idempotencyKey: null,
              createdAt: '2026-05-10T10:30:00.000Z',
              updatedAt: '2026-05-10T10:30:00.000Z',
            },
          ],
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

describe('PaymentHealthPanel', () => {
  it('renders the reconciliation summary, mismatch list and outbox tail', () => {
    render(<PaymentHealthPanel />);

    expect(screen.getByRole('heading', { name: /Payment Health/i })).toBeInTheDocument();
    expect(screen.getByTestId('payments-summary')).toHaveTextContent('Tenders scanned');
    expect(screen.getByText('Missing provider row')).toBeInTheDocument();
    expect(screen.getByText('Provider issue')).toBeInTheDocument();
    expect(screen.getAllByText('Wompi').length).toBeGreaterThan(0);
    expect(screen.getByText('Provider declined')).toBeInTheDocument();
  });
});
