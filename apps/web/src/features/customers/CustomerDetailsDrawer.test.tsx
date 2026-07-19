/**
 * ENG-132b — CustomerDetailsDrawer tests.
 *
 * Pins the row-detail Drawer that holds the columns trimmed off the
 * default CustomersPage table:
 *   - renders every trimmed field (identification, email, phone, type,
 *     location, status) for the given customer;
 *   - the Edit footer action calls onEdit (and is absent when onEdit is
 *     omitted);
 *   - stays closed when `customer` is null;
 *   - no serious accessibility violations.
 *
 * @module features/customers/CustomerDetailsDrawer.test
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Customer } from '@/types';
import { assertNoA11yViolations } from '@/test/a11y';
import { CustomerDetailsDrawer } from './CustomerDetailsDrawer';

// ENG-215 — the drawer now hosts the loyalty panel, which reads tRPC. This
// suite pins the drawer's own contract (trimmed fields + edit action) and
// mounts without a tRPC provider, so the child is stubbed; its behavior has
// its own suite in CustomerLoyaltyPanel.test.tsx.
vi.mock('@/features/customers/CustomerLoyaltyPanel', () => ({
  CustomerLoyaltyPanel: () => null,
}));

const customer = {
  id: 'c-1',
  name: 'Comercializadora Andina',
  email: 'ventas@andina.co',
  phone: '+57 300 111 2233',
  clientTypeId: 'mayorista',
  identificationTypeId: 'NIT',
  taxId: '900123456',
  city: 'Bogotá',
  state: 'Cundinamarca',
  country: 'Colombia',
  isActive: true,
} as unknown as Customer;

describe('CustomerDetailsDrawer (ENG-132b)', () => {
  it('renders the trimmed customer fields', () => {
    render(<CustomerDetailsDrawer customer={customer} onClose={vi.fn()} />);

    expect(screen.getByTestId('customer-details-drawer')).toBeInTheDocument();
    // The four fields trimmed from the default table all surface here.
    expect(screen.getByText('ventas@andina.co')).toBeInTheDocument(); // email
    expect(screen.getByText('+57 300 111 2233')).toBeInTheDocument(); // phone
    expect(screen.getByText('mayorista')).toBeInTheDocument(); // type
    expect(screen.getByText('Bogotá, Cundinamarca')).toBeInTheDocument(); // location
    expect(screen.getByText('NIT 900123456')).toBeInTheDocument(); // identification
    // The drawer heading is the customer name.
    expect(screen.getByRole('heading', { name: 'Comercializadora Andina' })).toBeInTheDocument();
  });

  it('resolves id-valued identification/type references to human labels', () => {
    const idCustomer = {
      ...customer,
      identificationTypeId: 'id-cc-nanoid',
      clientTypeId: 'id-mayorista-nanoid',
    } as unknown as Customer;
    render(
      <CustomerDetailsDrawer
        customer={idCustomer}
        identificationTypes={[
          {
            id: 'id-cc-nanoid',
            tenantId: 't1',
            code: 'CC',
            name: 'Cédula de ciudadanía',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]}
        clientTypes={[
          {
            id: 'id-mayorista-nanoid',
            tenantId: 't1',
            code: 'MAY',
            name: 'Mayorista',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]}
        onClose={vi.fn()}
      />
    );

    // The raw nanoids must NOT leak; the resolved code + name show instead.
    expect(screen.getByText('CC 900123456')).toBeInTheDocument();
    expect(screen.getByText('Mayorista')).toBeInTheDocument();
    expect(screen.queryByText(/id-cc-nanoid|id-mayorista-nanoid/)).not.toBeInTheDocument();
  });

  it('calls onEdit with the customer when the Edit footer action is clicked', () => {
    const onEdit = vi.fn();
    render(<CustomerDetailsDrawer customer={customer} onClose={vi.fn()} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: /edit customer|editar cliente/i }));
    expect(onEdit).toHaveBeenCalledWith(customer);
  });

  it('hides the Edit action when onEdit is not provided', () => {
    render(<CustomerDetailsDrawer customer={customer} onClose={vi.fn()} />);

    expect(
      screen.queryByRole('button', { name: /edit customer|editar cliente/i })
    ).not.toBeInTheDocument();
  });

  it('requests an allowlisted personal-data export when the admin action is clicked', () => {
    const onExportData = vi.fn();
    render(
      <CustomerDetailsDrawer customer={customer} onClose={vi.fn()} onExportData={onExportData} />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /export personal data|exportar datos personales/i })
    );
    expect(onExportData).toHaveBeenCalledWith(customer);
  });

  it('hides the privacy export without an admin callback and disables duplicate requests', () => {
    const { rerender } = render(<CustomerDetailsDrawer customer={customer} onClose={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: /export personal data|exportar datos personales/i })
    ).not.toBeInTheDocument();

    rerender(
      <CustomerDetailsDrawer
        customer={customer}
        onClose={vi.fn()}
        onExportData={vi.fn()}
        isExporting
      />
    );
    expect(
      screen.getByRole('button', { name: /preparing export|preparando exportación/i })
    ).toBeDisabled();
  });

  it('stays closed when customer is null', () => {
    render(<CustomerDetailsDrawer customer={null} onClose={vi.fn()} />);

    expect(screen.queryByTestId('customer-details-drawer')).not.toBeInTheDocument();
  });

  it('has no serious accessibility violations', async () => {
    const { baseElement } = render(
      <CustomerDetailsDrawer
        customer={customer}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onExportData={vi.fn()}
      />
    );
    // The Drawer renders into a portal on document.body — scan baseElement.
    await assertNoA11yViolations(baseElement);
  });
});
