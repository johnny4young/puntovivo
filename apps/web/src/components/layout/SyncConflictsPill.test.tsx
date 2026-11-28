import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import { SyncConflictsPill } from './SyncConflictsPill';

let mockConflicts = 0;
let mockRole = 'admin';
let mockOperationsActive = true;

vi.mock('@/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks')>()),
  useOfflineSync: () => ({ conflicts: mockConflicts }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: () => mockOperationsActive,
}));

describe('SyncConflictsPill', () => {
  beforeEach(() => {
    mockConflicts = 0;
    mockRole = 'admin';
    mockOperationsActive = true;
  });

  it('stays out of the header when nothing conflicts', () => {
    render(<SyncConflictsPill />);
    expect(screen.queryByTestId('sync-conflicts-pill')).not.toBeInTheDocument();
  });

  it('links admins to system support with the count when operations-center is active', () => {
    mockConflicts = 2;
    render(<SyncConflictsPill />);

    const pill = screen.getByRole('link', { name: '2 sync conflicts' });
    expect(pill).toHaveAttribute('href', '/operations?tab=sync');
  });

  it('shows managers a non-link status pill since sync recovery is admin-only', () => {
    mockConflicts = 2;
    mockRole = 'manager';
    render(<SyncConflictsPill />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('sync-conflicts-pill')).toHaveAccessibleName('2 sync conflicts');
  });

  it('shows admins a non-link status pill when operations-center is disabled', () => {
    mockConflicts = 2;
    mockOperationsActive = false;
    render(<SyncConflictsPill />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('sync-conflicts-pill')).toHaveAccessibleName('2 sync conflicts');
  });

  it('shows cashiers the count without a link they cannot open', () => {
    mockConflicts = 1;
    mockRole = 'cashier';
    render(<SyncConflictsPill />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('sync-conflicts-pill')).toHaveAccessibleName('1 sync conflict');
  });
});
