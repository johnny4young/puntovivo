import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import type { Provider } from '@/types';
import { PurchaseFinalizeModal } from './PurchaseFinalizeModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const provider: Provider = {
  id: 'provider-1',
  tenantId: 'tenant-1',
  name: 'Provider One',
  isActive: true,
  version: 0,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

describe('PurchaseFinalizeModal', () => {
  it('reports an invalid attempt and exposes the provider error as an alert', async () => {
    const user = userEvent.setup();
    const onInvalid = vi.fn();
    const onSubmit = vi.fn(async () => undefined);

    render(
      <PurchaseFinalizeModal
        isOpen
        total={125_000}
        providers={[provider]}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onInvalid={onInvalid}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Register Purchase' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Provider is required');
    expect(onInvalid).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits after provider selection and exposes bounded server feedback', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);

    const { rerender } = render(
      <PurchaseFinalizeModal
        isOpen
        total={125_000}
        providers={[provider]}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.selectOptions(screen.getByLabelText('Provider'), provider.id);
    await user.click(screen.getByRole('button', { name: 'Register Purchase' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { providerId: provider.id, notes: '' },
        expect.anything()
      )
    );

    rerender(
      <PurchaseFinalizeModal
        isOpen
        total={125_000}
        providers={[provider]}
        isSaving={false}
        error="Unable to register purchase"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to register purchase');
  });
});
