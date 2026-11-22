import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';
import { PharmacyTicketNotices } from './PharmacyTicketNotices';

describe('PharmacyTicketNotices', () => {
  it('asks for the customer and opens the picker', async () => {
    const onAssignCustomer = vi.fn();
    render(
      <PharmacyTicketNotices
        customerNote={{ missing: true }}
        hasControlled={false}
        onAssignCustomer={onAssignCustomer}
      />
    );
    expect(screen.getByTestId('pharmacy-customer-missing')).toHaveTextContent(
      'Assign the customer: the ticket has a prescription medicine'
    );
    await userEvent.click(screen.getByTestId('pharmacy-customer-assign'));
    expect(onAssignCustomer).toHaveBeenCalledOnce();
  });

  it('says why the customer is required and until when the prescription holds', () => {
    render(
      <PharmacyTicketNotices
        customerNote={{
          missing: false,
          validUntil: '2026-11-25',
          quantity: { remaining: 21, authorized: 21 },
        }}
        hasControlled
        customerName="Luis Herrera"
      />
    );
    const card = screen.getByTestId('pharmacy-customer-required');
    expect(card).toHaveTextContent('Luis Herrera');
    expect(card).toHaveTextContent(
      'Required because the ticket has a prescription medicine · prescription valid until November 25, 21 of 21 authorized'
    );
    expect(screen.getByTestId('pharmacy-controlled-notice')).toHaveTextContent(
      'Controlled medicines cannot be sold in Puntovivo yet'
    );
  });
});
