import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@/test/utils';
import i18n from '@/i18n';
import { PaymentProposalSection } from './PaymentProposalSection';

const reviewMutate = vi.fn();
const invalidate = vi.fn(async () => undefined);
const proposal = {
  id: 'proposal-1',
  tenantId: 'tenant-1',
  railId: 'wompi',
  statementKey: 'statement-1',
  selectedOutboxId: 'outbox-1',
  status: 'pending',
  createdAt: '2026-05-10T10:00:00.000Z',
  reviewedAt: null,
  reviewedBy: null,
  evidence: {
    statement: {
      railId: 'wompi',
      reference: 'PROVIDER-123',
      providerTransactionId: 'tx-123',
      amount: 100_000,
      currencyCode: 'COP',
      status: 'settled',
      settledAt: '2026-05-10T10:00:00.000Z',
      fee: 1200,
    },
    candidates: [
      {
        outboxId: 'outbox-1',
        salePaymentId: 'tender-1',
        reference: 'POS-123',
        providerTransactionId: null,
        amount: 100_000,
        currencyCode: 'COP',
        kind: 'charge',
        status: 'approved',
        createdAt: '2026-05-10T09:58:00.000Z',
      },
      {
        outboxId: 'outbox-2',
        salePaymentId: 'tender-2',
        reference: 'POS-OTHER',
        providerTransactionId: null,
        amount: 100_000,
        currencyCode: 'COP',
        kind: 'charge',
        status: 'approved',
        createdAt: '2026-05-10T09:57:00.000Z',
      },
    ],
    recommendedOutboxId: 'outbox-1',
    confidence: 'medium',
    explanation: 'Amount and time are plausible.',
    aiAuditLogId: 'ai-audit-1',
  },
};
let mockProposals: Array<typeof proposal> = [proposal];
let reportReviewError: (error: unknown) => void;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      payments: {
        listProposals: { invalidate },
        peekOutbox: { invalidate },
        reconciliation: { invalidate },
        methodBreakdown: { invalidate },
      },
      operations: { needsAttention: { invalidate } },
    }),
    payments: {
      listProposals: {
        useQuery: () => ({ data: mockProposals, isLoading: false, error: null }),
      },
      reviewProposal: {
        useMutation: (options: { onError: (error: unknown) => void }) => {
          reportReviewError = options.onError;
          return { isPending: false, mutate: reviewMutate };
        },
      },
    },
  },
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  reviewMutate.mockClear();
  mockProposals = [proposal];
});

describe('PaymentProposalSection', () => {
  it('shows provider evidence, candidate differences and blocks approval until explicit verification', async () => {
    render(<PaymentProposalSection isAdmin />);
    fireEvent.click(screen.getByTestId('payment-proposal-review-proposal-1'));
    expect(
      screen.getByText(
        'AI suggested this match. It has not confirmed settlement; verify the provider record yourself.'
      )
    ).toBeInTheDocument();
    expect(screen.getAllByText('PROVIDER-123').length).toBeGreaterThan(0);
    expect(screen.getByText('POS-123')).toBeInTheDocument();
    expect(screen.getByText('POS-OTHER')).toBeInTheDocument();
    expect(screen.getAllByText('COP').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/COP/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Provider and POS references differ.')).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Confirm settlement' });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByTestId('payment-proposal-provider-checked'));
    expect(approve).not.toBeDisabled();
    fireEvent.click(approve);
    await waitFor(() =>
      expect(reviewMutate).toHaveBeenCalledWith({ proposalId: 'proposal-1', decision: 'approve' })
    );
  });

  it.each(['en', 'es'] as const)(
    'keeps a translated review error inside the modal and clears it on reopen (%s)',
    async locale => {
      await i18n.changeLanguage(locale);
      render(<PaymentProposalSection isAdmin />);
      fireEvent.click(screen.getByTestId('payment-proposal-review-proposal-1'));
      act(() =>
        reportReviewError({
          data: { errorCode: 'PAYMENT_PROPOSAL_STALE' },
          message: 'raw provider diagnostic must not render',
        })
      );
      const dialog = screen.getByRole('dialog');
      const alert = within(dialog).getByRole('alert');
      expect(alert).toHaveTextContent(
        locale === 'en' ? 'No settlement was made' : 'No se liquidó nada'
      );
      expect(alert).not.toHaveTextContent('raw provider diagnostic');
      expect(alert).toHaveFocus();
      fireEvent.click(
        within(dialog).getByRole('button', { name: locale === 'en' ? 'Cancel' : 'Cancelar' })
      );
      fireEvent.click(screen.getByTestId('payment-proposal-review-proposal-1'));
      expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByTestId('payment-proposal-provider-checked')).not.toBeChecked();
    }
  );

  it.each([
    ['en', 'COP'],
    ['es', 'COP'],
    ['en', 'CLP'],
    ['es', 'CLP'],
  ])(
    'preserves fractional evidence despite zero-decimal currency defaults (%s/%s)',
    async (locale, currencyCode) => {
      await i18n.changeLanguage(locale);
      mockProposals = [
        {
          ...proposal,
          evidence: {
            ...proposal.evidence,
            statement: { ...proposal.evidence.statement, amount: 123.45, fee: 0.67, currencyCode },
            candidates: proposal.evidence.candidates.map((candidate, index) => ({
              ...candidate,
              amount: index === 0 ? 123.45 : 123.46,
              currencyCode,
            })),
          },
        },
      ];
      render(<PaymentProposalSection isAdmin />);
      fireEvent.click(screen.getByTestId('payment-proposal-review-proposal-1'));
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent(locale === 'en' ? '123.45' : '123,45');
      expect(dialog).toHaveTextContent(locale === 'en' ? '123.46' : '123,46');
      expect(dialog).toHaveTextContent(locale === 'en' ? '0.67' : '0,67');
    }
  );

  it('lets a manager inspect evidence but not approve or reject', () => {
    render(<PaymentProposalSection isAdmin={false} />);
    fireEvent.click(screen.getByTestId('payment-proposal-review-proposal-1'));
    expect(screen.getByRole('button', { name: 'Confirm settlement' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject proposal' })).toBeDisabled();
    expect(screen.getByTestId('payment-proposal-provider-checked')).toBeDisabled();
    expect(reviewMutate).not.toHaveBeenCalled();
  });

  it('presents the same human-review contract in neutral Spanish', async () => {
    await i18n.changeLanguage('es');
    render(<PaymentProposalSection isAdmin />);
    expect(
      screen.getByText(
        'Las recomendaciones se guardan para revisión humana. La IA nunca liquida un pago por sí sola.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('payment-proposal-review-proposal-1'));
    expect(
      screen.getByText('Las referencias del proveedor y el POS son distintas.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar liquidación' })).toBeDisabled();
  });
});
