import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import { RefundConfirmOverlay } from './RefundConfirmOverlay';

describe('RefundConfirmOverlay', () => {
  beforeAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('shows a visibly disabled primary action while an exact approval is missing', () => {
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        refundTotal={125}
        confirmDisabled
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirm return' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm return' })).toHaveClass(
      'disabled:bg-secondary-200',
      'disabled:text-secondary-500'
    );
  });

  it('selects every loaded ticket line when the overlay mounts', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        refundTotal={125}
        lines={[{ id: 'line-1', productName: 'Coffee', quantity: 2, total: 125 }]}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const line = screen.getByRole('checkbox', { name: 'Include line' });
    await waitFor(() => expect(line).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));

    expect(onConfirm).toHaveBeenCalledWith('[cash] (Coffee×2)');
  });

  it('restores default line selection and reason for each opening', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const lines = [{ id: 'line-1', productName: 'Coffee', quantity: 1, total: 125 }];
    const firstOpening = render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        refundTotal={125}
        lines={lines}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const line = screen.getByRole('checkbox', { name: 'Include line' });
    await waitFor(() => expect(line).toBeChecked());
    await user.click(line);
    await user.click(screen.getByRole('button', { name: 'Wrong item' }));

    firstOpening.unmount();
    render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        refundTotal={125}
        lines={lines}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const reopenedLine = screen.getByRole('checkbox', { name: 'Include line' });
    await waitFor(() => expect(reopenedLine).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));

    expect(onConfirm).toHaveBeenLastCalledWith('[cash] (Coffee×1)');
  });
});
