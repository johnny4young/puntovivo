import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { PeripheralForm } from './PeripheralForm';

describe('PeripheralForm submission boundary', () => {
  it('consumes an async rejection after the owning page mutation handles it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('handled by mutation onError'));

    render(
      <PeripheralForm
        isOpen
        initial={null}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'printer',
      driver: 'system',
      displayName: null,
      config: {},
    });
  });
});
