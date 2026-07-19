import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';

const { switchStaffMock, queryResult } = vi.hoisted(() => ({
  switchStaffMock: vi.fn(),
  queryResult: {
    data: [
      { id: 'cashier-ready', name: 'Cashier Ready', role: 'cashier', hasPin: true },
      { id: 'cashier-missing', name: 'Cashier Missing', role: 'cashier', hasPin: false },
    ],
    isLoading: false,
    error: null,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      switchableCashiers: {
        useQuery: () => queryResult,
      },
    },
  },
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ switchStaff: switchStaffMock }),
}));

import { StaffSwitchModal } from './StaffSwitchModal';

describe('StaffSwitchModal', () => {
  beforeEach(() => {
    switchStaffMock.mockReset().mockResolvedValue(undefined);
  });

  it('switches only to a PIN-configured cashier with six numeric digits', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<StaffSwitchModal isOpen onClose={onClose} />);

    expect(screen.getByText('PIN not configured')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Cashier Missing/i })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Cashier Ready/i }));
    await user.type(screen.getByLabelText('Staff PIN'), '24a6810');
    await user.click(screen.getByRole('button', { name: 'Switch cashier' }));

    expect(switchStaffMock).toHaveBeenCalledWith({
      targetUserId: 'cashier-ready',
      pin: '246810',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows localized validation before calling the server', async () => {
    const user = userEvent.setup();
    render(<StaffSwitchModal isOpen onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Switch cashier' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a cashier.');
    expect(switchStaffMock).not.toHaveBeenCalled();
  });
});
