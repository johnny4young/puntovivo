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
  it('requires a real TCP address instead of saving a network example', async () => {
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
    await user.selectOptions(screen.getByLabelText('Connection method'), 'escpos');
    expect(screen.getByLabelText('Printer network address')).toHaveValue('');
    expect(screen.getByLabelText('Advanced configuration (JSON)')).not.toHaveValue(
      expect.stringContaining('192.168.1.50')
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter the printer’s actual network address/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Printer network address'), '192.168.2.20');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ channel: 'tcp', host: '192.168.2.20' }),
      })
    );
  });
  it('converts an existing network printer repeatedly while retaining the latest auto-print opt-in', async () => {
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
          config: {
            channel: 'tcp',
            host: '192.168.2.20',
            port: 9100,
            paperWidth: '58mm',
            autoPrintOnComplete: true,
          },
        }}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await user.selectOptions(screen.getByLabelText('Connection method'), 'system');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ driver: 'system', config: { autoPrintOnComplete: true } })
    );
    await user.click(screen.getByTestId('peripheral-auto-print-toggle'));
    await user.selectOptions(screen.getByLabelText('Connection method'), 'escpos');
    expect(screen.getByLabelText('Printer network address')).toHaveValue('192.168.2.20');
    expect(screen.getByLabelText('Paper width')).toHaveValue('58mm');
    expect(screen.getByTestId('peripheral-auto-print-toggle')).not.toBeChecked();
    await user.selectOptions(screen.getByLabelText('Connection method'), 'system');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ driver: 'system', config: {} })
    );
  });
  it('explains an existing unsupported USB transport and allows conversion to System', async () => {
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
          config: { channel: 'usb', autoPrintOnComplete: true },
        }}
        isSaving={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('not implemented');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Connection method'), 'system');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ driver: 'system', config: { autoPrintOnComplete: true } })
    );
  });
});
