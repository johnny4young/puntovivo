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
