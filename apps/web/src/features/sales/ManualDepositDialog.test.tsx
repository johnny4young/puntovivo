import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { ManualDepositDialog } from './ManualDepositDialog';
import type { ManualDepositController, ManualDepositTender } from './useManualDeposit';

const tender: ManualDepositTender = {
  saleId: 'sale-1',
  salePaymentId: 'pay-1',
  saleNumber: 'V-000123',
  expectedAmount: 100,
  reference: 'RB-77',
  confirmationStatus: 'customer_reported',
  destination: { id: 'dest-1', label: 'Bancolombia', kind: 'bank' },
  presentationId: 'pres-9',
};

function controller(overrides: Partial<ManualDepositController> = {}): ManualDepositController {
  return {
    canDeposit: true,
    isSubmitting: false,
    error: null,
    result: null,
    history: { rows: [], isLoading: false, isError: false, refetch: vi.fn() },
    submit: vi.fn(),
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    salePaymentId: 'pay-1',
    saleId: 'sale-1',
    saleNumber: 'V-000123',
    amount: 100,
    reference: 'RB-77',
    confirmationStatus: 'needs_reconciliation',
    confirmedAt: '2026-11-20T14:00:00.000Z',
    createdAt: '2026-11-19T10:00:00.000Z',
    ...overrides,
  } as ManualDepositController['history']['rows'][number];
}

async function fillDeposit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Bank reference'), 'REF-501');
  await user.clear(screen.getByLabelText('Actual amount'));
  await user.type(screen.getByLabelText('Actual amount'), '40');
}

describe('ManualDepositDialog', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('sends the partial amount typed and renders the accumulated state the server returned', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();

    const { rerender } = render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({ submit })}
      />
    );
    await fillDeposit(user);
    await user.click(screen.getByRole('button', { name: 'Record deposit' }));

    expect(submit).toHaveBeenCalledTimes(1);
    const values = submit.mock.calls[0]?.[0] as {
      reference: string;
      verifiedAmount: number;
      valueDate: string;
    };
    expect(values.reference).toBe('REF-501');
    expect(values.verifiedAmount).toBe(40);
    expect(values.valueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The server answered with the tender's accumulated amount, not the 40 the
    // operator just sent: the dialog must show the server's figure.
    rerender(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({
          submit,
          result: { appliedAmount: 120, surplusAmount: 20, status: 'needs_reconciliation' },
        })}
      />
    );

    const statePanel = screen.getByTestId('manual-deposit-server-state');
    expect(within(statePanel).getByTestId('manual-deposit-applied-amount')).toHaveTextContent(
      '120'
    );
    expect(within(statePanel).getByTestId('manual-deposit-surplus-amount')).toHaveTextContent('20');
    expect(within(statePanel).getByTestId('manual-deposit-result-status')).toHaveTextContent(
      'Needs reconciliation'
    );
  });

  it('cannot submit without the fields the server requires', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();

    render(
      <ManualDepositDialog isOpen onClose={vi.fn()} tender={tender} deposit={controller({ submit })} />
    );

    await user.clear(screen.getByLabelText('Actual amount'));
    await user.click(screen.getByRole('button', { name: 'Record deposit' }));

    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the bank reference.')).toBeInTheDocument();
    expect(screen.getByText('Enter the amount the bank credited.')).toBeInTheDocument();
  });

  it('keeps the typed movement visible when the deposit fails', async () => {
    const user = userEvent.setup();
    const props = { isOpen: true, onClose: vi.fn(), tender };

    const { rerender } = render(
      <ManualDepositDialog {...props} deposit={controller()} />
    );
    await fillDeposit(user);

    rerender(
      <ManualDepositDialog
        {...props}
        deposit={controller({ error: 'The transfer tender was not found.' })}
      />
    );

    expect(screen.getByTestId('manual-deposit-error')).toHaveTextContent(
      'The transfer tender was not found.'
    );
    expect(screen.getByLabelText('Bank reference')).toHaveValue('REF-501');
    expect(screen.getByLabelText('Actual amount')).toHaveValue(40);
  });

  it('renders history rows the server sends without the accumulated fields', () => {
    render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({
          history: {
            rows: [
              row({ salePaymentId: 'pay-1', appliedAmount: 40, surplusAmount: 0 }),
              row({ salePaymentId: 'pay-3' }),
            ],
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          },
        })}
      />
    );

    const history = screen.getByTestId('manual-deposit-history');
    expect(within(history).getByTestId('manual-deposit-row-pay-1')).toHaveTextContent('40');
    expect(within(history).getByTestId('manual-deposit-row-pay-3')).toHaveTextContent(
      'Not reported'
    );
    expect(within(history).queryByText('NaN')).not.toBeInTheDocument();
  });

  it('reports an unavailable action instead of letting the operator try', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();

    render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({ canDeposit: false, submit })}
      />
    );
    await fillDeposit(user);

    expect(screen.getByTestId('manual-deposit-denied')).toHaveTextContent(
      'Only a manager or an administrator can record a deposit.'
    );
    expect(screen.getByRole('button', { name: 'Record deposit' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Record deposit' }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('blocks the confirm button while the server call is in flight', () => {
    render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({ isSubmitting: true })}
      />
    );

    expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
  });
});

/**
 * S12: the dialog must show the tender's live balance from the server, and it
 * must never pass the movement's recorded answer off as that balance. These
 * cover the branches the hook-only tests cannot reach: what the operator sees.
 */
describe('ManualDepositDialog current tender state', () => {
  const currentState = (
    overrides: Partial<NonNullable<ManualDepositController['currentState']>> = {}
  ): NonNullable<ManualDepositController['currentState']> => ({
    phase: 'ready',
    appliedAmount: 60,
    surplusAmount: 0,
    confirmationStatus: 'needs_reconciliation',
    isFetching: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  });

  it('prints the re-read balance, not the movement outcome, as the current state', () => {
    render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({
          // The movement recorded 100 while the tender now owes 40: the two
          // panels must disagree, and the current one is the server read.
          result: { appliedAmount: 100, surplusAmount: 0, status: 'manual_confirmed' },
          currentState: currentState({ appliedAmount: 60, surplusAmount: 25 }),
        })}
      />
    );

    const current = screen.getByTestId('manual-deposit-current-state');
    expect(within(current).getByTestId('manual-deposit-current-applied')).toHaveTextContent('60');
    expect(within(current).getByTestId('manual-deposit-current-surplus')).toHaveTextContent('25');
  });

  it('says it is reading instead of reusing the last known figures', () => {
    render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({
          result: { appliedAmount: 100, surplusAmount: 0, status: 'manual_confirmed' },
          currentState: currentState({ phase: 'loading', appliedAmount: null, surplusAmount: null }),
        })}
      />
    );

    expect(screen.getByTestId('manual-deposit-current-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('manual-deposit-current-applied')).not.toBeInTheDocument();
  });

  it('says the tender left the list once it settles', () => {
    render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({
          result: { appliedAmount: 100, surplusAmount: 0, status: 'manual_confirmed' },
          currentState: currentState({ phase: 'absent', appliedAmount: null, surplusAmount: null }),
        })}
      />
    );

    expect(screen.getByTestId('manual-deposit-current-absent')).toBeInTheDocument();
  });

  it('surfaces a failed refresh with a retry instead of showing stale numbers', () => {
    const refetch = vi.fn();
    render(
      <ManualDepositDialog
        isOpen
        onClose={vi.fn()}
        tender={tender}
        deposit={controller({
          result: { appliedAmount: 100, surplusAmount: 0, status: 'manual_confirmed' },
          currentState: currentState({
            phase: 'notRefreshed',
            appliedAmount: null,
            surplusAmount: null,
            error: 'network',
            refetch,
          }),
        })}
      />
    );

    expect(screen.getByTestId('manual-deposit-current-error')).toBeInTheDocument();
    expect(screen.queryByTestId('manual-deposit-current-applied')).not.toBeInTheDocument();
  });
});
