import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { CustomerCatalogItem } from '@/types';
import {
  CustomerCatalogFormModal,
  type CustomerCatalogFormValues,
} from './CustomerCatalogFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const existingItem: CustomerCatalogItem = {
  id: 'catalog-1',
  tenantId: 'tenant-1',
  code: 'CC',
  name: 'National ID',
  description: 'Use for adult citizens',
  isActive: false,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function renderModal({
  item = null,
  onClose = vi.fn(),
  onSubmit = vi
    .fn<(values: CustomerCatalogFormValues) => Promise<void>>()
    .mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
}: {
  item?: CustomerCatalogItem | null;
  onClose?: () => void;
  onSubmit?: (values: CustomerCatalogFormValues) => Promise<void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <CustomerCatalogFormModal
        isOpen
        item={item}
        singularLabel="identification type"
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('CustomerCatalogFormModal', () => {
  it('starts with the recognizable name and exact code task', async () => {
    const user = userEvent.setup();
    const { container } = renderModal();

    expect(
      await screen.findByRole('region', { name: 'Name the option and enter its code' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Visible name')).toBeVisible();
    expect(screen.getByLabelText('Fiscal or commercial code')).toBeVisible();

    const disclosure = screen.getByRole('button', { name: /Note and availability/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Internal note')).not.toBeVisible();

    await user.click(disclosure);
    expect(screen.getByLabelText('Internal note')).toBeVisible();
    expect(screen.getByLabelText('Available for new selections')).toBeChecked();
    await assertNoA11yViolations(container);
  });

  it('preserves mounted advanced values when the disclosure is collapsed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: CustomerCatalogFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('Visible name'), 'Temporary document');
    await user.type(screen.getByLabelText('Fiscal or commercial code'), 'TMP');
    const disclosure = screen.getByRole('button', { name: /Note and availability/ });
    await user.click(disclosure);
    await user.type(screen.getByLabelText('Internal note'), 'Only during migration');
    await user.click(screen.getByLabelText('Available for new selections'));
    await user.click(disclosure);

    expect(disclosure).toHaveTextContent('Unavailable');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Temporary document',
        code: 'TMP',
        description: 'Only during migration',
        isActive: false,
      }),
      expect.anything()
    );
  });

  it('guards a dirty draft and restores its value and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    const nameInput = await screen.findByLabelText('Visible name');
    await user.type(nameInput, 'Draft option');
    expect(screen.getByRole('status')).toHaveTextContent('Catalog changes have not been saved');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard catalog changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue('Draft option');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('delays guarded application navigation until discard is explicit', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ controller });

    await user.type(await screen.findByLabelText('Visible name'), 'Draft option');
    act(() => controller.request(continueNavigation));

    expect(screen.getByRole('dialog', { name: 'Discard catalog changes?' })).toBeInTheDocument();
    expect(continueNavigation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(continueNavigation).toHaveBeenCalledOnce();
  });

  it('rejects required values made only of spaces', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: CustomerCatalogFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('Visible name'), '   ');
    await user.type(screen.getByLabelText('Fiscal or commercial code'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('The identification type name is required')).toBeInTheDocument();
    expect(screen.getByText('The identification type code is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps a saved inactive item collapsed until requested', async () => {
    const user = userEvent.setup();
    renderModal({ item: existingItem });

    const disclosure = await screen.findByRole('button', { name: /Note and availability/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveTextContent('Unavailable');
    expect(screen.getByLabelText('Internal note')).not.toBeVisible();

    await user.click(disclosure);
    expect(screen.getByLabelText('Internal note')).toHaveValue('Use for adult citizens');
    expect(screen.getByLabelText('Available for new selections')).not.toBeChecked();
  });
});
