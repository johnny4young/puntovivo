import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import type { Location } from '@/types';
import { SiteLocationAssignmentsModal } from './SiteLocationAssignmentsModal';

const location: Location = {
  id: 'location-1',
  tenantId: 'tenant-1',
  code: 'FRONT',
  name: 'Front Rack',
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('SiteLocationAssignmentsModal', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('keeps unselected and empty rows on the theme surface while preserving assignment', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<() => Promise<void>>().mockResolvedValue();
    render(
      <SiteLocationAssignmentsModal
        isOpen
        site={null}
        locations={[location]}
        initialLocationIds={[]}
        isSaving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const row = screen.getByText('Front Rack').closest('label');
    expect(row).toHaveClass('bg-surface');
    expect(row).not.toHaveClass('bg-white');

    await user.type(screen.getByRole('textbox'), 'missing location');
    const empty = screen.getByText(i18n.t('sites.locations.noMatch', { ns: 'settings' }));
    expect(empty).toHaveClass('bg-surface');
    expect(empty).not.toHaveClass('bg-white');

    await user.clear(screen.getByRole('textbox'));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: i18n.t('sites.locations.save', { ns: 'settings' }) }));
    expect(onSubmit).toHaveBeenCalledWith(['location-1']);
  });
});
