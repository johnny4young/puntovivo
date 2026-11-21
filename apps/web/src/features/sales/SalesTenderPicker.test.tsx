import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { formatCurrency } from '@/lib/utils';
import { SalesTenderPicker } from './SalesTenderPicker';

const zones = vi.hoisted(() => ({ credit: true }));
vi.mock('@/features/modules/useRegisterZone', () => ({
  useRegisterZone: (zone: string) => zone !== 'credit' || zones.credit,
}));

describe('SalesTenderPicker', () => {
  beforeEach(() => {
    zones.credit = true;
  });

  it('marks the chosen tender and reports a new choice', () => {
    const onTenderChange = vi.fn();
    render(<SalesTenderPicker tender="card" onTenderChange={onTenderChange} cashDue={87_420} />);

    expect(screen.getByTestId('sales-tender-card')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('sales-tender-cash')).toHaveAttribute('aria-pressed', 'false');
    for (const tender of ['cash', 'card', 'transfer', 'credit', 'split']) {
      expect(screen.getByTestId(`sales-tender-${tender}`)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByTestId('sales-tender-split'));
    expect(onTenderChange).toHaveBeenCalledWith('split');
  });

  it('drops the credit tender while the store-credit zone is off', () => {
    zones.credit = false;
    render(<SalesTenderPicker tender="cash" onTenderChange={vi.fn()} cashDue={1_000} />);
    expect(screen.queryByTestId('sales-tender-credit')).not.toBeInTheDocument();
    expect(screen.getByTestId('sales-tender-split')).toBeInTheDocument();
  });

  it('shows exact cash and the next two bills with their change', () => {
    render(
      <SalesTenderPicker
        tender="cash"
        onTenderChange={vi.fn()}
        cashDue={87_420}
        onFastCash={vi.fn()}
      />
    );

    const exact = screen.getByTestId('checkout-fast-cash');
    expect(exact).toHaveTextContent('Exact');
    expect(exact).toHaveTextContent('F2');
    expect(exact).toHaveTextContent(formatCurrency(87_420));
    expect(exact).toHaveAttribute('aria-keyshortcuts', 'F2');

    const ninety = screen.getByTestId('sales-cash-key-90000');
    expect(ninety).toHaveTextContent(`Gets ${formatCurrency(90_000)}`);
    expect(ninety).toHaveTextContent(`change ${formatCurrency(2_580)}`);
    const hundred = screen.getByTestId('sales-cash-key-100000');
    expect(hundred).toHaveTextContent(`change ${formatCurrency(12_580)}`);
  });

  it('charges exact cash without an amount and a bill with its amount', () => {
    const onFastCash = vi.fn();
    render(
      <SalesTenderPicker
        tender="cash"
        onTenderChange={vi.fn()}
        cashDue={87_420}
        onFastCash={onFastCash}
      />
    );

    fireEvent.click(screen.getByTestId('checkout-fast-cash'));
    expect(onFastCash).toHaveBeenLastCalledWith();
    fireEvent.click(screen.getByTestId('sales-cash-key-90000'));
    expect(onFastCash).toHaveBeenLastCalledWith(90_000);
  });

  it('hides the cash keys for another tender, an unchargeable sale or nothing due', () => {
    const other = render(
      <SalesTenderPicker
        tender="transfer"
        onTenderChange={vi.fn()}
        cashDue={87_420}
        onFastCash={vi.fn()}
      />
    );
    expect(screen.queryByTestId('sales-cash-keys')).not.toBeInTheDocument();
    other.unmount();

    const blocked = render(
      <SalesTenderPicker tender="cash" onTenderChange={vi.fn()} cashDue={87_420} />
    );
    expect(screen.queryByTestId('sales-cash-keys')).not.toBeInTheDocument();
    blocked.unmount();

    render(
      <SalesTenderPicker tender="cash" onTenderChange={vi.fn()} cashDue={0} onFastCash={vi.fn()} />
    );
    expect(screen.queryByTestId('sales-cash-keys')).not.toBeInTheDocument();
  });
});
