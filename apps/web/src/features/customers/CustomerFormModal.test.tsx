import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { Customer, CustomerCatalogItem } from '@/types';
import { CustomerFormModal, type CustomerFormValues } from './CustomerFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const existingCustomer: Customer = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Marta Ruiz',
  email: 'marta@example.com',
  phone: '3001234567',
  taxId: '901234567',
  address: 'Main Street 10',
  city: 'Bogotá',
  creditLimit: 500,
  isActive: true,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  version: 1,
};

function renderModal({
  customer = null,
  defaultName,
  onClose = vi.fn(),
  onSubmit = vi.fn<(values: CustomerFormValues) => Promise<void>>().mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
  identificationTypes = [],
}: {
  customer?: Customer | null;
  defaultName?: string | undefined;
  onClose?: () => void;
  onSubmit?: (values: CustomerFormValues) => Promise<Customer | void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
  identificationTypes?: CustomerCatalogItem[];
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <CustomerFormModal
        isOpen
        customer={customer}
        identificationTypes={identificationTypes}
        personTypes={[]}
        regimeTypes={[]}
        clientTypes={[]}
        commercialActivities={[]}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
        defaultName={defaultName}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('CustomerFormModal', () => {
  it('starts with the short customer task and keeps billing details optional', async () => {
    const user = userEvent.setup();
    const { container } = renderModal({ defaultName: 'Checkout customer' });

    expect(
      await screen.findByRole('region', { name: 'Identify and contact the customer' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Checkout customer');
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const disclosure = screen.getByRole('button', { name: /Billing, address, and credit/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Tax ID')).not.toBeVisible();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Tax ID')).toBeInTheDocument();
    await assertNoA11yViolations(container);
  });

  it('preserves hidden advanced values when the operator collapses the disclosure', async () => {
    const user = userEvent.setup();
    renderModal();

    const disclosure = await screen.findByRole('button', {
      name: /Billing, address, and credit/,
    });
    await user.click(disclosure);
    await user.type(screen.getByLabelText('Tax ID'), '900123456');
    await user.click(disclosure);
    expect(screen.getByLabelText('Tax ID')).not.toBeVisible();

    await user.click(disclosure);
    expect(screen.getByLabelText('Tax ID')).toHaveValue('900123456');
  });

  it('warns before closing a dirty draft and restores its exact value and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    const nameInput = await screen.findByLabelText('Name');
    await user.type(nameInput, 'Neighborhood customer');
    expect(screen.getByRole('status')).toHaveTextContent('Customer changes have not been saved');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard customer changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue('Neighborhood customer');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps a quick-create default name clean and closes without an unnecessary decision', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ defaultName: 'Prefilled customer', onClose });

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('dialog', { name: 'Discard customer changes?' })
    ).not.toBeInTheDocument();
  });

  it('delays guarded application navigation until discard is explicit', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ controller });

    await user.type(await screen.findByLabelText('Name'), 'Draft customer');
    act(() => controller.request(continueNavigation));

    expect(screen.getByRole('dialog', { name: 'Discard customer changes?' })).toBeInTheDocument();
    expect(continueNavigation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(continueNavigation).toHaveBeenCalledOnce();
  });

  it('requests the browser unload safeguard only for a dirty draft', async () => {
    const user = userEvent.setup();
    renderModal();

    const cleanUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);

    await user.type(await screen.findByLabelText('Name'), 'Draft customer');
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('signals saved advanced details without forcing the secondary section open', async () => {
    renderModal({ customer: existingCustomer });

    const disclosure = (await screen.findByText('Saved details')).closest('button');
    expect(disclosure).not.toBeNull();
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Tax ID')).not.toBeVisible();
  });

  it('reveals the advanced section when its credit validation needs attention', async () => {
    const user = userEvent.setup();
    renderModal();

    const disclosure = await screen.findByRole('button', {
      name: /Billing, address, and credit/,
    });
    await user.type(screen.getByLabelText('Name'), 'Credit customer');
    await user.click(disclosure);
    fireEvent.change(screen.getByLabelText('Credit limit'), { target: { value: '-1' } });
    await user.click(disclosure);
    await user.click(screen.getByRole('button', { name: 'Create Customer' }));

    await waitFor(() => expect(disclosure).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText('Credit limit must be zero or greater')).toBeInTheDocument();
  });

  it('localizes seeded catalog options and their unavailable state', async () => {
    const user = userEvent.setup();
    renderModal({
      identificationTypes: [
        {
          id: 'id-cc',
          tenantId: 'tenant-1',
          code: 'CC',
          name: 'Cédula de ciudadanía',
          isActive: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await user.click(await screen.findByRole('button', { name: /Billing, address, and credit/ }));

    expect(
      screen.getByRole('option', { name: 'CC · Citizenship ID (Unavailable)' })
    ).toBeDisabled();
  });
});
