import { useEffect, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
const { auth } = vi.hoisted(() => ({
  auth: { user: null as { tenantId: string; id: string } | null },
}));
vi.mock('./AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/features/tenant/TenantProvider', () => ({
  TenantProvider: ({ children }: { children: ReactNode }) => children,
}));
import { AuthTenantBoundary } from './AuthTenantBoundary';

it('remounts query owners only when identity changes, not on same-owner renders', () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Probe() {
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return null;
  }
  const tree = () => (
    <AuthTenantBoundary>
      <Probe />
    </AuthTenantBoundary>
  );
  auth.user = null;
  const { rerender, unmount } = render(tree());
  auth.user = { tenantId: 'a', id: 'one' };
  rerender(tree());
  expect(mounted).toHaveBeenCalledTimes(2);
  auth.user = { tenantId: 'a', id: 'one' };
  rerender(tree());
  expect(mounted).toHaveBeenCalledTimes(2);
  auth.user = null;
  rerender(tree());
  auth.user = { tenantId: 'a', id: 'one' };
  rerender(tree());
  expect(mounted).toHaveBeenCalledTimes(4);
  auth.user = { tenantId: 'b', id: 'one' };
  rerender(tree());
  expect(mounted).toHaveBeenCalledTimes(5);
  unmount();
  expect(unmounted).toHaveBeenCalledTimes(5);
});
