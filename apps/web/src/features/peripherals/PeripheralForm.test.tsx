import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { PeripheralForm } from './PeripheralForm';

describe('PeripheralForm submission boundary', () => {
  it('opts into automatic system printing without adding ESC/POS settings', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PeripheralForm
        isOpen
        initial={null}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await user.click(screen.getByTestId('peripheral-auto-print-toggle'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({
      kind: 'printer',
      driver: 'system',
      displayName: null,
      config: { autoPrintOnComplete: true },
    });
  });
  it('edits thermal width through a visible control and keeps JSON settings synchronized', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PeripheralForm
        isOpen
        initial={{
          id: 'demo',
          kind: 'printer',
          driver: 'escpos',
          displayName: null,
          config: { channel: 'mock', paperWidth: '80mm', characterSet: 'cp858' },
        }}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await user.selectOptions(screen.getByLabelText('Paper width'), '58mm');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { channel: 'mock', paperWidth: '58mm', characterSet: 'cp858' },
      })
    );
  });
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
