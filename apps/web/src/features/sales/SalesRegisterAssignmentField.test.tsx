import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { RegisterAssignment } from '@/types';
import { SalesRegisterAssignmentField } from './SalesRegisterAssignmentField';

const availableAssignment: RegisterAssignment = {
  id: 'register-1',
  tenantId: 'tenant-1',
  siteId: 'site-1',
  registerName: 'Front register',
  label: 'Front register',
  openingFloat: 100,
  denominations: [{ value: 50, count: 2 }],
  sortOrder: 0,
  isActive: true,
  isOccupied: false,
  activeSessionId: null,
  activeCashierId: null,
  activeCashierName: null,
  openedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const occupiedAssignment: RegisterAssignment = {
  ...availableAssignment,
  id: 'register-2',
  registerName: 'Back register',
  label: 'Back register',
  isOccupied: true,
  activeSessionId: 'cash-session-2',
  activeCashierId: 'cashier-2',
  activeCashierName: 'Ana Perez',
};

describe('SalesRegisterAssignmentField', () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders register options and keeps occupied assignments unavailable', async () => {
    await i18next.changeLanguage('en');
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SalesRegisterAssignmentField
        assignments={[availableAssignment, occupiedAssignment]}
        selectedAssignment={availableAssignment}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Front register' }));

    expect(screen.getAllByText('Front register')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Back register · Open by Ana Perez' })).toBeInTheDocument();
    expect(
      screen.getByText('The opening dialog will preload the standard denomination template for this register.')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Front register' }));
    expect(onChange).toHaveBeenCalledWith('register-1');
  });

  it('shows the assignment hint when registers are available but none is selected', async () => {
    await i18next.changeLanguage('en');

    render(
      <SalesRegisterAssignmentField
        assignments={[availableAssignment]}
        selectedAssignment={null}
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByText('Choose the drawer you will operate before opening the cash session.')
    ).toBeInTheDocument();
  });
});
