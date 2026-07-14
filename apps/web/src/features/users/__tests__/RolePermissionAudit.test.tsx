import { render, screen, within } from '@/test/utils';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSION_TEMPLATES } from '@/features/auth/workspaceRoleTemplates';
import { RolePermissionAudit } from '../RolePermissionAudit';

describe('RolePermissionAudit', () => {
  it('renders every canonical workspace template and role', () => {
    render(<RolePermissionAudit />);

    expect(screen.getByRole('heading', { name: /default role permissions/i })).toBeInTheDocument();
    expect(ROLE_PERMISSION_TEMPLATES).toHaveLength(9);
    expect(screen.getAllByRole('row')).toHaveLength(10);

    for (const role of ['Admin', 'Manager', 'Cashier', 'Viewer']) {
      expect(screen.getByRole('columnheader', { name: role })).toBeInTheDocument();
    }
  });

  it('pins the dashboard and setup access templates', () => {
    render(<RolePermissionAudit />);

    const dashboardRow = screen.getByRole('row', { name: /^dashboard/i });
    expect(
      within(dashboardRow).getByLabelText('Cashier: Dashboard — No access')
    ).toBeInTheDocument();
    expect(within(dashboardRow).getByLabelText('Viewer: Dashboard — Allowed')).toBeInTheDocument();

    const setupRow = screen.getByRole('row', { name: /^setup/i });
    expect(within(setupRow).getByLabelText('Admin: Setup — Allowed')).toBeInTheDocument();
    expect(within(setupRow).getByLabelText('Manager: Setup — No access')).toBeInTheDocument();
  });

  it('explains that modules and server authorization can narrow access', () => {
    render(<RolePermissionAudit />);

    expect(screen.getByText(/active modules can hide individual tools/i)).toBeInTheDocument();
    expect(screen.getByText(/server authorization is always enforced/i)).toBeInTheDocument();
  });
});
