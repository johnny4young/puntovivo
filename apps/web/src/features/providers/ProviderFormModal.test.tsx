import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { City, Provider } from '@/types';
import { ProviderFormModal, type ProviderFormValues } from './ProviderFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const cities: City[] = [
  {
    id: 'city-1',
    tenantId: 'tenant-1',
    departmentId: 'department-1',
    name: 'Bogotá',
    code: '11001',
    departmentName: 'Cundinamarca',
    countryName: 'Colombia',
    isActive: true,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  },
];

const existingProvider: Provider = {
  id: 'provider-1',
  tenantId: 'tenant-1',
  name: 'Distribuciones Norte',
  contactName: 'Marta Ruiz',
  email: 'marta@example.com',
  phone: '3001234567',
  taxId: '901234567',
  address: 'Main Street 10',
  cityId: 'city-1',
  isActive: true,
  version: 1,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function renderModal({
  provider = null,
  onClose = vi.fn(),
  onSubmit = vi.fn<(values: ProviderFormValues) => Promise<void>>().mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
}: {
  provider?: Provider | null;
  onClose?: () => void;
  onSubmit?: (values: ProviderFormValues) => Promise<void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <ProviderFormModal
        isOpen
        provider={provider}
        cities={cities}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('ProviderFormModal', () => {
  it('starts with the short provider task and keeps administrative details optional', async () => {
    const user = userEvent.setup();
    const { container } = renderModal();

    expect(
      await screen.findByRole('region', { name: 'Identify and contact the provider' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Provider Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();

    const disclosure = screen.getByRole('button', { name: /Tax, location, and status/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Tax ID')).not.toBeVisible();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Tax ID')).toBeVisible();
    await assertNoA11yViolations(container);
  });

  it('preserves hidden advanced values and submits one complete payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: ProviderFormValues) => Promise<void>>().mockResolvedValue();
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('Provider Name'), 'Supplier One');
    const disclosure = screen.getByRole('button', { name: /Tax, location, and status/ });
    await user.click(disclosure);
    await user.type(screen.getByLabelText('Tax ID'), '900123456');
    await user.selectOptions(screen.getByLabelText('City'), 'city-1');
    await user.type(screen.getByLabelText('Address'), 'Avenue 10');
    await user.click(disclosure);
    expect(screen.getByLabelText('Tax ID')).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Create Provider' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Supplier One',
        taxId: '900123456',
        cityId: 'city-1',
        address: 'Avenue 10',
      }),
      expect.anything()
    );
  });

  it('warns before closing a dirty draft and restores its exact value and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    const nameInput = await screen.findByLabelText('Provider Name');
    await user.type(nameInput, 'Draft supplier');
    expect(screen.getByRole('status')).toHaveTextContent('Provider changes have not been saved');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard provider changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue('Draft supplier');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('delays guarded application navigation until discard is explicit', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ controller });

    await user.type(await screen.findByLabelText('Provider Name'), 'Draft supplier');
    act(() => controller.request(continueNavigation));

    expect(screen.getByRole('dialog', { name: 'Discard provider changes?' })).toBeInTheDocument();
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

    await user.type(await screen.findByLabelText('Provider Name'), 'Draft supplier');
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('signals saved administrative details without forcing the secondary section open', async () => {
    renderModal({ provider: existingProvider });

    const disclosure = (await screen.findByText('Saved details')).closest('button');
    expect(disclosure).not.toBeNull();
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Tax ID')).not.toBeVisible();
  });

  it('keeps invalid email feedback in the essential task', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: ProviderFormValues) => Promise<void>>().mockResolvedValue();
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('Provider Name'), 'Supplier One');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Create Provider' }));

    expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
