import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Customer } from '@/types';
import {
  SalePaymentModal,
  type SalePaymentValues,
} from './SalePaymentModal';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    customerLedger: {
      getBalance: {
        useQuery: () => ({ data: { balance: 0 }, isLoading: false, error: null }),
      },
    },
  },
}));

const customers: Customer[] = [];

function createProps(overrides?: Partial<React.ComponentProps<typeof SalePaymentModal>>) {
  return {
    isOpen: true,
    total: 100,
    customers,
    isSaving: false,
    error: null,
    onClose: vi.fn(),
    onSubmit: vi.fn(async () => undefined) as (v: SalePaymentValues) => Promise<void>,
    ...overrides,
  };
}

describe('SalePaymentModal — split payments', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('defaults to single-tender mode and submits the legacy shape', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues).toBeDefined();
    expect(submittedValues.tenders).toEqual([]);
    expect(submittedValues.paymentMethod).toBe('cash');
    expect(submittedValues.amountReceived).toBe(100);
  });

  it('blocks confirm while split tenders do not sum to the total', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    // Enable split mode (adds one initial tender at amount=total=100).
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    // Adjust the amount below total — confirm must go disabled.
    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    await user.clear(firstAmount);
    await user.type(firstAmount, '40');

    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a balanced two-tender split and forwards the tenders array on submit', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    // First tender already seeded to 100. Lower it to 60 (cash).
    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    fireEvent.change(firstAmount, { target: { value: '60' } });

    // Add a second tender row and fill it in (card, 40, reference).
    await user.click(screen.getByRole('button', { name: /Add payment method/i }));
    const secondAmount = screen.getByLabelText('Amount for tender 2') as HTMLInputElement;
    fireEvent.change(secondAmount, { target: { value: '40' } });
    const secondReference = screen.getByLabelText('Reference for tender 2');
    await user.type(secondReference, 'AUTH-42');
    const secondMethod = screen.getByLabelText('Method for tender 2') as HTMLSelectElement;
    await user.selectOptions(secondMethod, 'card');

    // Confirm becomes enabled because Σ=100 matches total.
    const confirmBtn = screen.getByRole('button', { name: /Confirm Sale/i });
    await waitFor(() => {
      expect(confirmBtn).not.toBeDisabled();
    });

    await user.click(confirmBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues).toBeDefined();
    expect(submittedValues.tenders).toHaveLength(2);
    expect(submittedValues.tenders[0]?.method).toBe('cash');
    expect(submittedValues.tenders[0]?.amount).toBe(60);
    expect(submittedValues.tenders[1]?.method).toBe('card');
    expect(submittedValues.tenders[1]?.amount).toBe(40);
    expect(submittedValues.tenders[1]?.reference).toBe('AUTH-42');
  });

  it('does not offer credit as a split tender option', async () => {
    render(<SalePaymentModal {...createProps()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstMethod = screen.getByLabelText('Method for tender 1') as HTMLSelectElement;
    expect(Array.from(firstMethod.options).map(option => option.value)).not.toContain('credit');
  });

  it('switching back to single-tender strips the tenders from submit payload', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));
    await user.click(screen.getByRole('button', { name: /Use single tender/i }));
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues).toBeDefined();
    expect(submittedValues.tenders).toEqual([]);
  });
});

describe('SalePaymentModal — tip / propina (ENG-039d)', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('defaults to zero tip and submits tipMethod=null', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.tipAmount).toBe(0);
    expect(submittedValues.tipMethod).toBeNull();
  });

  it('applies the 10% preset on top of the base total and submits tipMethod=percentage', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    const user = userEvent.setup();
    // Three preset buttons render: "No tip", "10%", "15%".
    await user.click(screen.getByRole('button', { name: '10%' }));

    // Grand total header updates to base+tip = 110.
    await waitFor(() => {
      expect(screen.getByText(/Base \$100\.00 \+ tip \$10\.00/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.amountReceived).toBeCloseTo(110, 2);
    expect(submittedValues.tipAmount).toBeCloseTo(10, 2);
    expect(submittedValues.tipMethod).toBe('percentage');
  });

  it('treats a custom tip amount as tipMethod=fixed at submit time', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 80 })} />);

    const user = userEvent.setup();
    const customInput = screen.getByLabelText('Custom amount') as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '7' } });

    await waitFor(() => {
      expect(screen.getByText(/Base \$80\.00 \+ tip \$7\.00/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.amountReceived).toBeCloseTo(87, 2);
    expect(submittedValues.tipAmount).toBeCloseTo(7, 2);
    expect(submittedValues.tipMethod).toBe('fixed');
  });

  it('updates the seeded split tender when a tip is added after split mode is enabled', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    expect(firstAmount.value).toBe('100');

    await user.click(screen.getByRole('button', { name: '10%' }));

    await waitFor(() => {
      expect(firstAmount.value).toBe('110');
    });
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });

  it('seeds the first split tender at base + tip and blocks confirm until the sum matches', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    const user = userEvent.setup();
    // Pick 10% tip first so the seeded split tender will be 110.
    await user.click(screen.getByRole('button', { name: '10%' }));
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    // The seeded amount mirrors base + tip (= grandTotal).
    expect(firstAmount.value).toBe('110');

    // Lower the first tender below the grand total — confirm goes
    // disabled because Σ no longer matches `total + tip = 110`.
    fireEvent.change(firstAmount, { target: { value: '100' } });
    expect(screen.getByRole('button', { name: /Confirm Sale/i })).toBeDisabled();
  });
});

describe('SalePaymentModal — service charge / propina sugerida (ENG-039d3)', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('hides the service section when the tenant rate is zero and submits zeros', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SalePaymentModal {...createProps({ onSubmit, total: 100 })} />);

    expect(screen.queryByLabelText('Service charge')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.serviceChargeAmount).toBe(0);
    expect(submittedValues.serviceChargeRate).toBeNull();
  });

  it('auto-applies the tenant rate as a read-only line and folds it into the grand total', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <SalePaymentModal
        {...createProps({ onSubmit, total: 100, serviceChargeRate: 10 })}
      />
    );

    expect(screen.getByLabelText('Service charge')).toBeInTheDocument();
    // The breakdown line above the totals header shows base + service.
    expect(
      screen.getByText(/Base \$100\.00 \+ service \$10\.00$/i)
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(submittedValues.serviceChargeRate).toBe(10);
    // amountReceived defaults to grandTotal (110) when service is on.
    expect(submittedValues.amountReceived).toBeCloseTo(110, 2);
  });

  it('combines service charge and a tip preset into the grand total breakdown', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <SalePaymentModal
        {...createProps({ onSubmit, total: 100, serviceChargeRate: 10 })}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '10%' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Base \$100\.00 \+ service \$10\.00 \+ tip \$10\.00$/i)
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Confirm Sale/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submittedValues = onSubmit.mock.calls.at(0)?.at(0) as unknown as SalePaymentValues;
    expect(submittedValues.tipAmount).toBeCloseTo(10, 2);
    expect(submittedValues.serviceChargeAmount).toBeCloseTo(10, 2);
    // grandTotal = base 100 + service 10 + tip 10 = 120.
    expect(submittedValues.amountReceived).toBeCloseTo(120, 2);
  });

  it('seeds the first split tender at base + service when split mode is enabled', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <SalePaymentModal
        {...createProps({ onSubmit, total: 100, serviceChargeRate: 10 })}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Split payment across tenders/i }));

    const firstAmount = screen.getByLabelText('Amount for tender 1') as HTMLInputElement;
    expect(firstAmount.value).toBe('110');
  });
});
