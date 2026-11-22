import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import { CustomerLedgerAbonoModal } from './CustomerLedgerAbonoModal';

function renderTill(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <CustomerLedgerAbonoModal
      mode="till"
      isOpen
      isSaving={false}
      error={null}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      balance={84_300}
      customerName="Juan Pérez"
    />
  );
  return onSubmit;
}

describe('CustomerLedgerAbonoModal at the register', () => {
  it('names the customer and the debt, and pays it all in one tap', async () => {
    const user = userEvent.setup();
    const onSubmit = renderTill();

    expect(screen.getByRole('dialog', { name: 'Payment from Juan Pérez' })).toHaveTextContent(
      `Owes ${formatCurrency(84_300)}`
    );

    await user.click(screen.getByTestId('customer-ledger-pay-all'));
    expect(screen.getByTestId('customer-ledger-amount-input')).toHaveValue(84_300);
    await user.click(screen.getByRole('button', { name: 'Take payment' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ amount: 84_300, note: '' }));
  });

  it('refuses more than the customer owes', async () => {
    const user = userEvent.setup();
    const onSubmit = renderTill();

    const amount = screen.getByTestId('customer-ledger-amount-input');
    await user.clear(amount);
    await user.type(amount, '90000');
    await user.click(screen.getByRole('button', { name: 'Take payment' }));

    expect(await screen.findByTestId('customer-ledger-amount-error')).toHaveTextContent(
      `cannot exceed what is owed (${formatCurrency(84_300)})`
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
