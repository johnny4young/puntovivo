import { render, screen, within } from '@/test/utils';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSION_TEMPLATES } from '@/features/auth/workspaceRoleTemplates';
import { RolePermissionAudit } from '../RolePermissionAudit';

describe('RolePermissionAudit', () => {
  it('renders every canonical workspace template and role', () => {
    render(<RolePermissionAudit />);

    expect(screen.getByRole('heading', { name: /default role permissions/i })).toBeInTheDocument();
    expect(ROLE_PERMISSION_TEMPLATES).toHaveLength(8);
    expect(screen.getAllByRole('row')).toHaveLength(9);

    for (const role of ['Admin', 'Manager', 'Cashier', 'Viewer']) {
      expect(screen.getByRole('columnheader', { name: role })).toBeInTheDocument();
    }
  });

  it('pins the daily-work and business-management access templates', () => {
    render(<RolePermissionAudit />);

    const operateRow = screen.getByRole('row', { name: /^today and close/i });
    expect(
      within(operateRow).getByLabelText('Cashier: Today and close — No access')
    ).toBeInTheDocument();
    expect(
      within(operateRow).getByLabelText('Viewer: Today and close — Allowed')
    ).toBeInTheDocument();

    const setupRow = screen.getByRole('row', { name: /^manage business/i });
    expect(within(setupRow).getByLabelText('Admin: Manage business — Allowed')).toBeInTheDocument();
    expect(
      within(setupRow).getByLabelText('Manager: Manage business — No access')
    ).toBeInTheDocument();
  });

  it('explains that modules and server authorization can narrow access', () => {
    render(<RolePermissionAudit />);

    expect(screen.getByText(/active modules can hide individual tools/i)).toBeInTheDocument();
    expect(screen.getByText(/server authorization is always enforced/i)).toBeInTheDocument();
  });
});
