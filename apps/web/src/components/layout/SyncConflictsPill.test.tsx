import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import { SyncConflictsPill } from './SyncConflictsPill';

let mockConflicts = 0;
let mockRole = 'admin';

vi.mock('@/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks')>()),
  useOfflineSync: () => ({ conflicts: mockConflicts }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}));

describe('SyncConflictsPill', () => {
  beforeEach(() => {
    mockConflicts = 0;
    mockRole = 'admin';
  });

  it('stays out of the header when nothing conflicts', () => {
    render(<SyncConflictsPill />);
    expect(screen.queryByTestId('sync-conflicts-pill')).not.toBeInTheDocument();
  });

  it('links managers and admins to system support with the count', () => {
    mockConflicts = 2;
    render(<SyncConflictsPill />);

    const pill = screen.getByRole('link', { name: '2 sync conflicts' });
    expect(pill).toHaveAttribute('href', '/operations?tab=sync');
  });

  it('shows cashiers the count without a link they cannot open', () => {
    mockConflicts = 1;
    mockRole = 'cashier';
    render(<SyncConflictsPill />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('sync-conflicts-pill')).toHaveAccessibleName('1 sync conflict');
  });
});
