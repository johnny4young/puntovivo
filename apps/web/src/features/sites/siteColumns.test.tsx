import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { describe, expect, it, vi } from 'vitest';
import { DataTable } from '@/components/tables/DataTable';
import { render } from '@/test/utils';
import type { Site } from '@/types/domain';
import { createSiteColumns } from './siteColumns';

const site: Site = {
  id: 'site-north',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  name: 'North Store',
  address: 'Main Street',
  phone: null,
  isActive: true,
  assignedLocationCount: 2,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function renderSiteActions(language: 'en' | 'es', canManage: boolean) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onManageLocations = vi.fn();
  render(
    <DataTable
      columns={createSiteColumns({
        t: i18next.getFixedT(language, 'settings'),
        canManage,
        onEdit,
        onDelete,
        onManageLocations,
      })}
      data={[site]}
    />
  );
  return { onEdit, onDelete, onManageLocations };
}

describe('site action buttons', () => {
  it.each([
    {
      language: 'en' as const,
      labels: {
        manage: 'Manage Locations for North Store',
        edit: 'Edit North Store',
        delete: 'Delete North Store',
      },
    },
    {
      language: 'es' as const,
      labels: {
        manage: 'Gestionar ubicaciones para North Store',
        edit: 'Editar North Store',
        delete: 'Eliminar North Store',
      },
    },
  ])('names every icon action with its row context in $language', async ({ language, labels }) => {
    const user = userEvent.setup();
    const callbacks = renderSiteActions(language, true);
    for (const label of Object.values(labels)) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
    await user.click(screen.getByRole('button', { name: labels.manage }));
    await user.click(screen.getByRole('button', { name: labels.edit }));
    await user.click(screen.getByRole('button', { name: labels.delete }));
    expect(callbacks.onManageLocations).toHaveBeenCalledWith(site);
    expect(callbacks.onEdit).toHaveBeenCalledWith(site);
    expect(callbacks.onDelete).toHaveBeenCalledWith(site);
  });

  it('keeps all three named actions disabled without site-management permission', () => {
    const callbacks = renderSiteActions('en', false);
    expect(screen.getByRole('button', { name: 'Manage Locations for North Store' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit North Store' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete North Store' })).toBeDisabled();
    expect(callbacks.onManageLocations).not.toHaveBeenCalled();
    expect(callbacks.onEdit).not.toHaveBeenCalled();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });
});
