import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';
import { StaffPinModal } from './StaffPinModal';

describe('StaffPinModal', () => {
  it('normalizes numeric input and submits exactly six digits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <StaffPinModal
        user={{ id: 'u1', name: 'Cashier One', hasPin: false }}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.type(screen.getByLabelText('New 6-digit PIN'), '12a3456');
    await user.click(screen.getByRole('button', { name: 'Save PIN' }));
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('requires confirmation before clearing an enrolled PIN', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <StaffPinModal
        user={{ id: 'u1', name: 'Cashier One', hasPin: true }}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Remove PIN' }));
    expect(screen.getByText(/Remove the staff PIN for Cashier One/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove PIN' }));
    expect(onSubmit).toHaveBeenCalledWith(null);
  });
});
