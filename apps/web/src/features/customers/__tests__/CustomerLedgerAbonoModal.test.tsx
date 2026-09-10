/**
 * CustomerLedgerAbonoModal validation + submission contract.
 *
 * The modal is a thin form on top of the parent's mutation. These
 * tests pin the validation rules per `mode` ('payment' vs
 * 'adjustment') so the operator sees consistent error feedback
 * regardless of which CTA opened the modal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent } from '@testing-library/react';
import i18next from '@/i18n';
import { render, screen } from '@/test/utils';
import { CustomerLedgerAbonoModal } from '../CustomerLedgerAbonoModal';

describe('CustomerLedgerAbonoModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18next.changeLanguage('en');
  });

  function renderModal(
    overrides: Partial<React.ComponentProps<typeof CustomerLedgerAbonoModal>> = {}
  ) {
    const props = {
      mode: 'payment' as const,
      isOpen: true,
      isSaving: false,
      error: null,
      onClose: vi.fn(),
      onSubmit: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    render(<CustomerLedgerAbonoModal {...props} />);
    return props;
  }

  it('renders the payment title + confirm copy when mode=payment', () => {
    renderModal({ mode: 'payment' });
    expect(screen.getByRole('heading', { name: 'Receive payment' })).toBeInTheDocument();
    expect(screen.getByText('Confirm payment')).toBeInTheDocument();
  });

  it('renders the adjustment title + confirm copy when mode=adjustment', () => {
    renderModal({ mode: 'adjustment' });
    expect(screen.getByRole('heading', { name: 'Charge to account' })).toBeInTheDocument();
    expect(screen.getByText('Confirm adjustment')).toBeInTheDocument();
  });

  it('blocks payment submission when amount is zero', async () => {
    const user = userEvent.setup();
    const props = renderModal({ mode: 'payment' });

    // Default amount is 0; click confirm without typing.
    await user.click(screen.getByText('Confirm payment'));
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByTestId('customer-ledger-amount-error')).toBeInTheDocument();
  });

  it('submits a positive payment without a note (note is optional)', async () => {
    const user = userEvent.setup();
    const props = renderModal({ mode: 'payment' });

    const amountInput = screen.getByTestId('customer-ledger-amount-input');
    // Use fireEvent.change so react-hook-form picks up the numeric
    // value via valueAsNumber.
    fireEvent.change(amountInput, { target: { value: '250' } });
    await user.click(screen.getByText('Confirm payment'));

    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(props.onSubmit).toHaveBeenCalledWith({ amount: 250, note: '' });
  });

  it('blocks adjustment submission when note is empty', async () => {
    const user = userEvent.setup();
    const props = renderModal({ mode: 'adjustment' });

    const amountInput = screen.getByTestId('customer-ledger-amount-input');
    fireEvent.change(amountInput, { target: { value: '75' } });
    await user.click(screen.getByText('Confirm adjustment'));

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByTestId('customer-ledger-note-error')).toBeInTheDocument();
  });

  it('submits an adjustment with both sign + required note', async () => {
    const user = userEvent.setup();
    const props = renderModal({ mode: 'adjustment' });

    fireEvent.change(screen.getByTestId('customer-ledger-amount-input'), {
      target: { value: '-40' },
    });
    fireEvent.change(screen.getByTestId('customer-ledger-note-input'), {
      target: { value: 'Devolución producto fuera de plazo' },
    });
    await user.click(screen.getByText('Confirm adjustment'));

    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(props.onSubmit).toHaveBeenCalledWith({
      amount: -40,
      note: 'Devolución producto fuera de plazo',
    });
  });

  it('blocks adjustment submission when amount is zero', async () => {
    const user = userEvent.setup();
    const props = renderModal({ mode: 'adjustment' });

    fireEvent.change(screen.getByTestId('customer-ledger-note-input'), {
      target: { value: 'note ok' },
    });
    await user.click(screen.getByText('Confirm adjustment'));

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByTestId('customer-ledger-amount-error')).toBeInTheDocument();
  });

  it('surfaces a parent error message inline', () => {
    renderModal({ error: 'Server is down' });
    expect(screen.getByTestId('customer-ledger-abono-error')).toHaveTextContent('Server is down');
  });
  /**
   * A held Enter halves the customer's debt.
   *
   * The confirm button sits in the modal FOOTER, which `Modal` renders as a
   * sibling of the form, so `disabled={isSaving}` is not on the submit path at
   * all. The form carries no submit button of its own and exactly one
   * implicit-submission-blocking field (the amount; a `<textarea>` does not
   * block), which is precisely the HTML condition under which Enter submits.
   * And `customerLedger.addPayment` is not a critical command, so there is no
   * envelope and no server-side dedupe behind it: each repeat is another row
   * against the customer's balance.
   *
   * jsdom implements no implicit submission at all, so the event is dispatched
   * directly here; a real keyboard dispatches it once per key repeat.
   */
  function ledgerForm(): HTMLFormElement {
    // The modal portals into document.body.
    const form = document.querySelector('form');
    if (!form) throw new Error('ledger form not rendered');
    return form;
  }

  it('records one payment however many submit events the form receives', async () => {
    let releaseWrite!: () => void;
    const props = renderModal({
      mode: 'payment',
      onSubmit: vi.fn(
        () =>
          new Promise<void>(resolve => {
            releaseWrite = () => resolve();
          })
      ),
    });

    fireEvent.change(screen.getByTestId('customer-ledger-amount-input'), {
      target: { value: '250' },
    });
    // One act() around all three, so they land the way a key repeat does:
    // before React has re-rendered anything the first one caused.
    await act(async () => {
      fireEvent.submit(ledgerForm());
      fireEvent.submit(ledgerForm());
      fireEvent.submit(ledgerForm());
    });

    // Non-vacuous in both directions: the first dispatch DID reach the
    // handler, and the repeats did not.
    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(props.onSubmit).toHaveBeenCalledWith({ amount: 250, note: '' });

    await act(async () => {
      releaseWrite();
    });
  });

  it('refuses a submit event while the parent reports the write in flight', async () => {
    const props = renderModal({ mode: 'payment', isSaving: true });

    fireEvent.change(screen.getByTestId('customer-ledger-amount-input'), {
      target: { value: '250' },
    });
    await act(async () => {
      fireEvent.submit(ledgerForm());
    });

    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
