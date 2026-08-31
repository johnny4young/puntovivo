import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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

  it('shows ticket lines as read-only and submits only the persisted reason contract', async () => {
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

    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.getByText('×2')).toBeInTheDocument();
    expect(
      screen.getByText(/This refunds the entire ticket and restores every stock-tracked line/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Store credit' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);

    await user.click(screen.getByRole('button', { name: 'Wrong item' }));
    await user.click(screen.getByRole('button', { name: 'Confirm return' }));
    expect(onConfirm).toHaveBeenLastCalledWith('wrong_item');
  });

  it('clears the prior reason each time the overlay opens', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const lines = [{ id: 'line-1', productName: 'Coffee', quantity: 1, total: 125 }];
    const view = render(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        refundTotal={125}
        lines={lines}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Wrong item' }));
    view.rerender(
      <RefundConfirmOverlay
        isOpen={false}
        isPending={false}
        refundTotal={125}
        lines={lines}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    view.rerender(
      <RefundConfirmOverlay
        isOpen
        isPending={false}
        refundTotal={125}
        lines={lines}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Confirm return' }));
    expect(onConfirm).toHaveBeenLastCalledWith(undefined);
  });
});
