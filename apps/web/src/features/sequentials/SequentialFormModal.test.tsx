import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import type { Sequential, Site } from '@/types';
import { SequentialFormModal, type SequentialFormSubmission } from './SequentialFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const sites: Site[] = [
  {
    id: 'site-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    name: 'Main Site',
    address: null,
    phone: null,
    isActive: true,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  },
];

const existingSequential: Sequential = {
  id: 'sequential-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  siteName: 'Main Site',
  documentType: 'sale',
  prefix: 'POS-',
  currentValue: 42,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function renderModal({
  sequential = null,
  onClose = vi.fn(),
  onSubmit = vi
    .fn<(values: SequentialFormSubmission) => Promise<void>>()
    .mockResolvedValue(undefined),
  controller = createNavigationGuardController(),
}: {
  sequential?: Sequential | null;
  onClose?: () => void;
  onSubmit?: (values: SequentialFormSubmission) => Promise<void>;
  controller?: ReturnType<typeof createNavigationGuardController>;
} = {}) {
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <SequentialFormModal
        isOpen
        sequential={sequential}
        sites={sites}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );

  return { ...view, controller };
}

describe('SequentialFormModal', () => {
  it('starts with document identity and keeps manual counter adjustment advanced', async () => {
    const user = userEvent.setup();
    const { container } = renderModal();

    expect(
      await screen.findByRole('region', {
        name: 'Choose the document and its recognizable prefix',
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Site')).toBeVisible();
    expect(screen.getByLabelText('Document type')).toBeVisible();
    expect(screen.getByLabelText('Prefix (optional)')).toBeVisible();

    const disclosure = screen.getByRole('button', { name: /Manual counter adjustment/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Last number used')).not.toBeVisible();

    await user.click(disclosure);
    expect(screen.getByLabelText('Last number used')).toBeVisible();
    await assertNoA11yViolations(container);
  });

  it('creates a sequence without sending the untouched default counter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: SequentialFormSubmission) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ onSubmit });

    await user.selectOptions(await screen.findByLabelText('Site'), 'site-1');
    await user.selectOptions(screen.getByLabelText('Document type'), 'purchase');
    await user.type(screen.getByLabelText('Prefix (optional)'), ' COM- ');
    await user.click(screen.getByRole('button', { name: 'Create sequence' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const submission = onSubmit.mock.calls[0]?.[0];
    expect(submission).toEqual({
      siteId: 'site-1',
      documentType: 'purchase',
      prefix: 'COM-',
    });
    expect(submission).not.toHaveProperty('currentValue');
  });

  it('preserves a concurrently advancing counter when only the prefix changes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: SequentialFormSubmission) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ sequential: existingSequential, onSubmit });

    expect(await screen.findByText('Main Site')).toBeInTheDocument();
    expect(screen.getByText('Sale')).toBeInTheDocument();
    const prefix = screen.getByLabelText('Prefix (optional)');
    await user.clear(prefix);
    await user.type(prefix, 'FAC-');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const submission = onSubmit.mock.calls[0]?.[0];
    expect(submission).toEqual({
      siteId: 'site-1',
      documentType: 'sale',
      prefix: 'FAC-',
    });
    expect(submission).not.toHaveProperty('currentValue');
  });

  it('submits an explicitly adjusted counter and updates the next-number preview', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: SequentialFormSubmission) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ sequential: existingSequential, onSubmit });

    const disclosure = await screen.findByRole('button', {
      name: /Manual counter adjustment/,
    });
    expect(disclosure).toHaveTextContent('Next: POS-000043');
    await user.click(disclosure);
    const counter = screen.getByLabelText('Last number used');
    await user.clear(counter);
    await user.type(counter, '43');
    expect(disclosure).toHaveTextContent('Next: POS-000044');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      siteId: 'site-1',
      documentType: 'sale',
      prefix: 'POS-',
      currentValue: 43,
    });
  });

  it('warns when an administrator lowers the persisted counter', async () => {
    const user = userEvent.setup();
    renderModal({ sequential: existingSequential });

    await user.click(await screen.findByRole('button', { name: /Manual counter adjustment/ }));
    const counter = screen.getByLabelText('Last number used');
    await user.clear(counter);
    await user.type(counter, '41');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The next number could repeat an identifier that was already issued'
    );
  });

  it.each([
    ['-1', 'Last number used cannot be negative'],
    ['4.5', 'Last number used must be a whole number'],
  ])('rejects the invalid manual counter %s', async (input, message) => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(values: SequentialFormSubmission) => Promise<void>>()
      .mockResolvedValue(undefined);
    renderModal({ sequential: existingSequential, onSubmit });

    await user.click(await screen.findByRole('button', { name: /Manual counter adjustment/ }));
    const counter = screen.getByLabelText('Last number used');
    await user.clear(counter);
    await user.type(counter, input);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('warns before closing a dirty draft and restores its exact prefix and focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ sequential: existingSequential, onClose });

    const prefix = await screen.findByLabelText('Prefix (optional)');
    await user.type(prefix, 'DRAFT');
    expect(screen.getByRole('status')).toHaveTextContent('Numbering changes have not been saved');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard numbering changes?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(prefix).toHaveFocus());
    expect(prefix).toHaveValue('POS-DRAFT');
  });

  it('guards application navigation and browser unload for a dirty draft', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    const continueNavigation = vi.fn();
    renderModal({ sequential: existingSequential, controller });

    await user.type(await screen.findByLabelText('Prefix (optional)'), 'DRAFT');
    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    act(() => controller.request(continueNavigation));
    expect(screen.getByRole('dialog', { name: 'Discard numbering changes?' })).toBeInTheDocument();
    expect(continueNavigation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(continueNavigation).toHaveBeenCalledOnce();
  });
});
