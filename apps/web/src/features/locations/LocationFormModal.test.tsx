import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { Location } from '@/types';
import { LocationFormModal, type LocationFormValues } from './LocationFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const existingLocation: Location = {
  id: 'location-1',
  tenantId: 'tenant-1',
  code: 'WH-N',
  name: 'North Warehouse',
  description: 'Back wall, second aisle',
  isActive: true,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function renderModal({
  location = null,
  onClose = vi.fn(),
  onSubmit = vi.fn<(values: LocationFormValues) => Promise<void>>().mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
}: {
  location?: Location | null;
  onClose?: () => void;
  onSubmit?: (values: LocationFormValues) => Promise<void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <LocationFormModal
        isOpen
        location={location}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('LocationFormModal', () => {
  it('starts with the short identification task and keeps administration optional', async () => {
    const user = userEvent.setup();
    const { container } = renderModal();

    expect(
      await screen.findByRole('region', { name: 'Identify where inventory is kept' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toBeVisible();
    expect(screen.getByLabelText('Name')).toBeVisible();

    const disclosure = screen.getByRole('button', { name: /Description and availability/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Description')).not.toBeVisible();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Description')).toBeVisible();
    await assertNoA11yViolations(container);
  });

  it('preserves hidden administrative values and submits one complete payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: LocationFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('Code'), 'STG-A');
    await user.type(screen.getByLabelText('Name'), 'Staging Area');
    const disclosure = screen.getByRole('button', { name: /Description and availability/ });
    await user.click(disclosure);
    await user.type(screen.getByLabelText('Description'), 'Next to receiving');
    await user.click(screen.getByLabelText('Location is active'));
    await user.click(disclosure);
    expect(screen.getByLabelText('Description')).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Create Location' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'STG-A',
        name: 'Staging Area',
        description: 'Next to receiving',
        isActive: false,
      }),
      expect.anything()
    );
  });

  it('warns before closing a dirty draft and restores its exact value and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    const codeInput = await screen.findByLabelText('Code');
    await user.type(codeInput, 'DRAFT');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Location changes have not been saved'
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard location changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(codeInput).toHaveFocus());
    expect(codeInput).toHaveValue('DRAFT');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('delays guarded application navigation until discard is explicit', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ controller });

    await user.type(await screen.findByLabelText('Code'), 'DRAFT');
    act(() => controller.request(continueNavigation));

    expect(screen.getByRole('dialog', { name: 'Discard location changes?' })).toBeInTheDocument();
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

    await user.type(await screen.findByLabelText('Code'), 'DRAFT');
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('keeps saved administrative details collapsed until they are requested', async () => {
    const user = userEvent.setup();
    renderModal({ location: existingLocation });

    const disclosure = await screen.findByRole('button', { name: /Description and availability/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Description')).not.toBeVisible();

    await user.click(disclosure);
    expect(screen.getByLabelText('Description')).toHaveValue('Back wall, second aisle');
    expect(screen.getByLabelText('Location is active')).toBeChecked();
  });

  it('keeps required-field feedback in the essential task', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: LocationFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.click(screen.getByRole('button', { name: 'Create Location' }));

    expect(await screen.findByText('Location code is required')).toBeInTheDocument();
    expect(screen.getByText('Location name is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
