import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { Unit } from '@/types';
import { UnitFormModal, type UnitFormValues } from './UnitFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const existingUnit: Unit = {
  id: 'unit-1',
  tenantId: 'tenant-1',
  name: 'Kilogram',
  abbreviation: 'kg',
  dimension: 'mass',
  standardCode: 'KGM',
  referenceFactor: 1,
  isActive: true,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function renderModal({
  unit = null,
  onClose = vi.fn(),
  onSubmit = vi.fn<(values: UnitFormValues) => Promise<void>>().mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
}: {
  unit?: Unit | null;
  onClose?: () => void;
  onSubmit?: (values: UnitFormValues) => Promise<void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <UnitFormModal
        isOpen
        unit={unit}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('UnitFormModal', () => {
  it('starts with the short naming task and keeps technical details optional', async () => {
    const user = userEvent.setup();
    const { container } = renderModal();

    expect(
      await screen.findByRole('region', { name: 'Name the way you sell or count' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Unit Name')).toBeVisible();
    expect(screen.getByLabelText('Abbreviation')).toBeVisible();

    const disclosure = screen.getByRole('button', {
      name: /Classification and e-invoicing/,
    });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Physical dimension')).not.toBeVisible();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Physical dimension')).toBeVisible();
    await assertNoA11yViolations(container);
  });

  it('preserves hidden advanced values and submits one complete payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: UnitFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('Unit Name'), 'Box');
    await user.type(screen.getByLabelText('Abbreviation'), 'bx');
    const disclosure = screen.getByRole('button', {
      name: /Classification and e-invoicing/,
    });
    await user.click(disclosure);
    await user.selectOptions(screen.getByLabelText('Physical dimension'), 'count');
    await user.type(screen.getByLabelText('Standard code (UN/CEFACT)'), 'C62');
    await user.click(disclosure);
    expect(screen.getByLabelText('Standard code (UN/CEFACT)')).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Create Unit' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Box',
        abbreviation: 'bx',
        dimension: 'count',
        standardCode: 'C62',
        isActive: true,
      }),
      expect.anything()
    );
  });

  it('warns before closing a dirty draft and restores its exact value and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    const nameInput = await screen.findByLabelText('Unit Name');
    await user.type(nameInput, 'Draft unit');
    expect(screen.getByRole('status')).toHaveTextContent('Unit changes have not been saved');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard unit changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue('Draft unit');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('delays guarded application navigation until discard is explicit', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ controller });

    await user.type(await screen.findByLabelText('Unit Name'), 'Draft unit');
    act(() => controller.request(continueNavigation));

    expect(screen.getByRole('dialog', { name: 'Discard unit changes?' })).toBeInTheDocument();
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

    await user.type(await screen.findByLabelText('Unit Name'), 'Draft unit');
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('signals saved classification without forcing the secondary section open', async () => {
    renderModal({ unit: existingUnit });

    const disclosure = (await screen.findByText('Saved details')).closest('button');
    expect(disclosure).not.toBeNull();
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Physical dimension')).not.toBeVisible();
  });

  it('keeps required-field feedback in the essential task', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: UnitFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.click(screen.getByRole('button', { name: 'Create Unit' }));

    expect(await screen.findByText('Unit name is required')).toBeInTheDocument();
    expect(screen.getByText('Abbreviation is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
