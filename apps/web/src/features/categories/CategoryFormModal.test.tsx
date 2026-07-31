import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { Category } from '@/types';
import { CategoryFormModal, type CategoryFormValues } from './CategoryFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const parentOptions = [
  { id: 'beverages', name: 'Beverages', depth: 0 },
  { id: 'hot-drinks', name: 'Hot drinks', depth: 1 },
];

const existingCategory: Category = {
  id: 'category-1',
  tenantId: 'tenant-1',
  name: 'Tea',
  description: 'Loose leaf and tea bags',
  parentId: 'hot-drinks',
  version: 3,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function renderModal({
  category = null,
  onClose = vi.fn(),
  onSubmit = vi.fn<(values: CategoryFormValues) => Promise<void>>().mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
}: {
  category?: Category | null;
  onClose?: () => void;
  onSubmit?: (values: CategoryFormValues) => Promise<void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <CategoryFormModal
        isOpen
        category={category}
        parentOptions={parentOptions}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('CategoryFormModal', () => {
  it('starts with the short naming task and keeps organization optional', async () => {
    const user = userEvent.setup();
    const { container } = renderModal();

    expect(
      await screen.findByRole('region', { name: 'Create an easy-to-recognize group' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Category name')).toBeVisible();

    const disclosure = screen.getByRole('button', { name: /Organization and description/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Place inside another category (optional)')).not.toBeVisible();
    expect(screen.getByLabelText('Description (optional)')).not.toBeVisible();

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Place inside another category (optional)')).toBeVisible();
    expect(screen.getByLabelText('Description (optional)')).toBeVisible();
    await assertNoA11yViolations(container);
  });

  it('preserves collapsed organization values and submits one complete payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: CategoryFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.type(await screen.findByLabelText('Category name'), 'Tea');
    const disclosure = screen.getByRole('button', { name: /Organization and description/ });
    await user.click(disclosure);
    await user.selectOptions(
      screen.getByLabelText('Place inside another category (optional)'),
      'hot-drinks'
    );
    await user.type(screen.getByLabelText('Description (optional)'), 'Loose leaf and tea bags');
    await user.click(disclosure);
    expect(screen.getByLabelText('Description (optional)')).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Create Category' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Tea',
        parentId: 'hot-drinks',
        description: 'Loose leaf and tea bags',
      }),
      expect.anything()
    );
  });

  it('warns before closing a dirty draft and restores its exact value and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });

    const nameInput = await screen.findByLabelText('Category name');
    await user.type(nameInput, 'Draft category');
    expect(screen.getByRole('status')).toHaveTextContent('Category changes have not been saved');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard category changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue('Draft category');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('delays guarded application navigation until discard is explicit', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ controller });

    await user.type(await screen.findByLabelText('Category name'), 'Draft category');
    act(() => controller.request(continueNavigation));

    expect(screen.getByRole('dialog', { name: 'Discard category changes?' })).toBeInTheDocument();
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

    await user.type(await screen.findByLabelText('Category name'), 'Draft category');
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
  });

  it('keeps saved organization details collapsed until they are requested', async () => {
    const user = userEvent.setup();
    renderModal({ category: existingCategory });

    const disclosure = await screen.findByRole('button', {
      name: /Organization and description/,
    });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveTextContent('Saved organization');
    expect(screen.getByLabelText('Description (optional)')).not.toBeVisible();

    await user.click(disclosure);
    expect(screen.getByLabelText('Place inside another category (optional)')).toHaveValue(
      'hot-drinks'
    );
    expect(screen.getByLabelText('Description (optional)')).toHaveValue('Loose leaf and tea bags');
  });

  it('keeps required-field feedback in the essential task', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: CategoryFormValues) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.click(screen.getByRole('button', { name: 'Create Category' }));

    expect(await screen.findByText('Category name is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
