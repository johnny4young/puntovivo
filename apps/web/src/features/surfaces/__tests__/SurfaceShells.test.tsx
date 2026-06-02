/**
 * ENG-183 — Route-level scope-gate tests for the 4 full-screen surfaces.
 *
 * Gating moved OUT of each shell and UP into `SurfaceShellRoute` (so a
 * hidden module never loads the shell bundle on direct-URL navigation).
 * These tests prove the route-level module gate for every surface — the
 * "hidden modules do not leak visible routes" acceptance criterion:
 *   - Module ON  -> shell chrome + outlet child render.
 *   - Module OFF -> the fallback (Navigate to /dashboard) fires; the shell
 *     and its outlet child never render.
 *   - Module state still HYDRATING (placeholder) -> loading is shown and
 *     NEITHER the shell NOR the redirect fires, so a cold direct-URL hit on
 *     an enabled-but-default-off surface is not bounced to /dashboard.
 *
 * Role gating is exercised by ProtectedRoute's own tests; it is mocked as
 * a passthrough here so the module gate is the only thing under test.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { salesRoles } from '@/features/auth/roleAccess';
import type { ClientModuleId } from '@/features/modules';

const { useModulesSnapshotMock } = vi.hoisted(() => ({
  useModulesSnapshotMock: vi.fn(),
}));

vi.mock('@/features/modules/ModulesContext', () => ({
  useModulesSnapshot: () => useModulesSnapshotMock(),
  useIsModuleActive: () => true,
}));

vi.mock('@/features/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/feedback/LoadingState', () => ({
  PageLoadingState: () => <div data-testid="loading" />,
}));

vi.mock('react-i18next', async () => {
  const mod = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...mod,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { changeLanguage: vi.fn() },
    }),
  };
});

import { SurfaceShellRoute } from '../SurfaceShellRoute';
import { TouchShell } from '../TouchShell';
import { KdsShell } from '../KdsShell';
import { CustomerDisplayShell } from '../CustomerDisplayShell';
import { MobileWaiterShell } from '../MobileWaiterShell';

beforeEach(() => {
  useModulesSnapshotMock.mockReset();
});

function setModule(moduleId: ClientModuleId, active: boolean, isPlaceholder = false): void {
  useModulesSnapshotMock.mockReturnValue({
    modules: { [moduleId]: active },
    isLoading: isPlaceholder,
    isPlaceholder,
  });
}

function renderSurface(
  Shell: () => ReactElement,
  moduleId: ClientModuleId,
  path: string
): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path}
          element={
            <SurfaceShellRoute allowedRoles={salesRoles} allowedModule={moduleId}>
              <Shell />
            </SurfaceShellRoute>
          }
        >
          <Route index element={<span data-testid="outlet-child">CHILD</span>} />
        </Route>
        <Route
          path="/dashboard"
          element={<span data-testid="dashboard-fallback">DASHBOARD</span>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('POS Touch surface gate (ENG-183)', () => {
  it('renders the shell + outlet child when pos-touch is on', () => {
    setModule('pos-touch', true);
    renderSurface(TouchShell, 'pos-touch', '/touch');
    expect(screen.getByTestId('touch-shell')).toBeInTheDocument();
    expect(screen.getByTestId('outlet-child')).toHaveTextContent('CHILD');
  });

  it('redirects to /dashboard without mounting the shell when pos-touch is off', () => {
    setModule('pos-touch', false);
    renderSurface(TouchShell, 'pos-touch', '/touch');
    expect(screen.queryByTestId('touch-shell')).toBeNull();
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });

  it('shows loading (no redirect, no shell) while the module state is still hydrating', () => {
    // Cold direct-URL load: the surface is enabled server-side but the
    // snapshot is still the optimistic default (off). Must NOT bounce.
    setModule('pos-touch', false, /* isPlaceholder */ true);
    renderSurface(TouchShell, 'pos-touch', '/touch');
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(screen.queryByTestId('touch-shell')).toBeNull();
    expect(screen.queryByTestId('dashboard-fallback')).toBeNull();
  });
});

describe('KDS surface gate (ENG-183)', () => {
  it('renders the fullscreen shell + outlet child when kds is on', () => {
    setModule('kds', true);
    renderSurface(KdsShell, 'kds', '/kds');
    const shell = screen.getByTestId('kds-shell');
    expect(shell).toBeInTheDocument();
    expect(shell.className).toMatch(/bg-secondary-950/);
    expect(screen.getByTestId('outlet-child')).toBeInTheDocument();
  });

  it('redirects to /dashboard without mounting the shell when kds is off', () => {
    setModule('kds', false);
    renderSurface(KdsShell, 'kds', '/kds');
    expect(screen.queryByTestId('kds-shell')).toBeNull();
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });
});

describe('Customer Display surface gate (ENG-183)', () => {
  it('renders the shell + outlet child when customer-display is on', () => {
    setModule('customer-display', true);
    renderSurface(CustomerDisplayShell, 'customer-display', '/customer-display');
    expect(screen.getByTestId('customer-display-shell')).toBeInTheDocument();
    expect(screen.getByTestId('outlet-child')).toBeInTheDocument();
  });

  it('redirects to /dashboard without mounting the shell when customer-display is off', () => {
    setModule('customer-display', false);
    renderSurface(CustomerDisplayShell, 'customer-display', '/customer-display');
    expect(screen.queryByTestId('customer-display-shell')).toBeNull();
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });
});

describe('Mobile Waiter surface gate (ENG-183)', () => {
  it('renders the phone-width shell + outlet child when mobile-waiter is on', () => {
    setModule('mobile-waiter', true);
    renderSurface(MobileWaiterShell, 'mobile-waiter', '/m');
    const shell = screen.getByTestId('mobile-waiter-shell');
    expect(shell).toBeInTheDocument();
    expect(shell.className).toMatch(/max-w-md/);
    expect(screen.getByTestId('outlet-child')).toBeInTheDocument();
  });

  it('redirects to /dashboard without mounting the shell when mobile-waiter is off', () => {
    setModule('mobile-waiter', false);
    renderSurface(MobileWaiterShell, 'mobile-waiter', '/m');
    expect(screen.queryByTestId('mobile-waiter-shell')).toBeNull();
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });
});
