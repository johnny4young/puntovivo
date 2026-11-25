import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import { CustomerAccountBar } from './CustomerAccountBar';

describe('CustomerAccountBar', () => {
  it('reads what the customer owes against the cupo and takes an abono', () => {
    const onPay = vi.fn();
    render(
      <CustomerAccountBar account={{ balance: 84_300, creditLimit: 150_000 }} onPay={onPay} />
    );

    expect(screen.getByTestId('customer-account-owed')).toHaveTextContent(
      `owes ${formatCurrency(84_300)} of ${formatCurrency(150_000)}`
    );
    expect(screen.queryByText('Juan Pérez')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('customer-account-pay'));
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it('names the customer only when asked and leaves the abono out without a handler', () => {
    render(
      <CustomerAccountBar account={{ balance: 12_000, creditLimit: 0 }} customerName="Juan Pérez" />
    );

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('JP')).toBeInTheDocument();
    expect(screen.getByTestId('customer-account-owed')).toHaveTextContent(
      `owes ${formatCurrency(12_000)}`
    );
    expect(screen.getByTestId('customer-account-owed')).not.toHaveTextContent('of');
    expect(screen.queryByTestId('customer-account-pay')).not.toBeInTheDocument();
  });

  it('reads a negative balance as credit in favor', () => {
    render(<CustomerAccountBar account={{ balance: -5_000, creditLimit: 50_000 }} />);
    expect(screen.getByTestId('customer-account-owed')).toHaveTextContent(
      `credit in favor ${formatCurrency(5_000)}`
    );
  });
});
