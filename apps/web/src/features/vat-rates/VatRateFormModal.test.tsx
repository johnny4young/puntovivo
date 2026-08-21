import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { VatRate } from '@/types';
import { VatRateFormModal, type VatRateFormValues } from './VatRateFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const existingVatRate: VatRate = {
  id: 'vat-rate-1',
  tenantId: 'tenant-1',
  name: 'VAT 19%',
  rate: 19,
  kind: 'iva',
  isActive: false,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function renderModal({
  vatRate = null,
  onClose = vi.fn(),
  onSubmit = vi.fn<(values: VatRateFormValues) => Promise<void>>().mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
}: {
  vatRate?: VatRate | null;
  onClose?: () => void;
  onSubmit?: (values: VatRateFormValues) => Promise<void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <VatRateFormModal
        isOpen
        vatRate={vatRate}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('VatRateFormModal', () => {
  it('starts with the tax identity task and keeps availability optional', async () => {
    const user = userEvent.setup();
    const { container } = renderModal();

    expect(
      await screen.findByRole('region', { name: 'Name the tax and enter its percentage' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('VAT rate name')).toBeVisible();
    expect(screen.getByLabelText('Percentage')).toBeVisible();

    const disclosure = screen.getByRole('button', { name: /Availability/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('VAT rate is active')).not.toBeVisible();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('VAT rate is active')).toBeVisible();
    await assertNoA11yViolations(container);
  });

  it('preserves hidden availability and submits one complete payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: VatRateFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('VAT rate name'), 'VAT 5%');
    const percentage = screen.getByLabelText('Percentage');
    await user.clear(percentage);
    await user.type(percentage, '5');
    const disclosure = screen.getByRole('button', { name: /Availability/ });
    await user.click(disclosure);
    await user.click(screen.getByLabelText('VAT rate is active'));
    await user.click(disclosure);

    expect(screen.getByLabelText('VAT rate is active')).not.toBeVisible();
    expect(disclosure).toHaveTextContent('Marked inactive');
    await user.click(screen.getByRole('button', { name: 'Create VAT Rate' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'VAT 5%', rate: 5, isActive: false }),
      expect.anything()
    );
  });

  it('warns before closing a dirty draft and restores its exact value and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    const nameInput = await screen.findByLabelText('VAT rate name');
    await user.type(nameInput, 'Draft VAT');
    expect(screen.getByRole('status')).toHaveTextContent('VAT rate changes have not been saved');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard VAT rate changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue('Draft VAT');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('delays guarded application navigation until discard is explicit', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ controller });

    await user.type(await screen.findByLabelText('VAT rate name'), 'Draft VAT');
    act(() => controller.request(continueNavigation));

    expect(screen.getByRole('dialog', { name: 'Discard VAT rate changes?' })).toBeInTheDocument();
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

    await user.type(await screen.findByLabelText('VAT rate name'), 'Draft VAT');
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('keeps saved inactive status collapsed until it is requested', async () => {
    const user = userEvent.setup();
    renderModal({ vatRate: existingVatRate });

    const disclosure = await screen.findByRole('button', { name: /Availability/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveTextContent('Marked inactive');
    expect(screen.getByLabelText('VAT rate is active')).not.toBeVisible();

    await user.click(disclosure);
    expect(screen.getByLabelText('VAT rate is active')).not.toBeChecked();
  });

  it.each([
    ['0', 0],
    ['100', 100],
  ])('accepts the inclusive percentage boundary %s', async (input, expected) => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: VatRateFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('VAT rate name'), `VAT ${input}%`);
    const percentage = screen.getByLabelText('Percentage');
    await user.clear(percentage);
    await user.type(percentage, input);
    await user.click(screen.getByRole('button', { name: 'Create VAT Rate' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ rate: expected }),
      expect.anything()
    );
  });

  it.each([
    ['-0.01', 'Percentage cannot be negative'],
    ['100.01', 'Percentage cannot exceed 100'],
  ])('rejects an out-of-range percentage %s', async (input, message) => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: VatRateFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('VAT rate name'), 'Invalid VAT');
    const percentage = screen.getByLabelText('Percentage');
    await user.clear(percentage);
    await user.type(percentage, input);
    await user.click(screen.getByRole('button', { name: 'Create VAT Rate' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a name that contains only spaces', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: VatRateFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('VAT rate name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create VAT Rate' }));

    expect(await screen.findByText('VAT rate name is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
