/**
 * /  — modules store regression test.
 *
 * Pins the contract every gated route relies on, now that the state lives
 * in a Zustand store fed by `useModulesSync` (mounted via `<ModulesSync />`)
 * instead of a React context:
 * - Defaults applied while the query is loading (no flash).
 * - Server response overrides defaults once it lands.
 * - Unknown ids in the response are ignored (forwards-compat).
 * - Disabled when not authenticated (avoid UNAUTHORIZED on /login).
 * - Reset to defaults on logout so no stale tenant snapshot leaks.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { useAuthMock, useGetEffectiveMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetEffectiveMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    modules: {
      getEffective: {
        useQuery: (input: unknown, options: { enabled?: boolean }) =>
          useGetEffectiveMock(input, options),
      },
    },
  },
}));

import {
  ModulesSync,
  useIsModuleActive,
  useModulesSnapshot,
  __modulesStoreForTests,
} from '../ModulesContext';
import { CLIENT_MODULE_DEFAULTS } from '../manifest';

beforeEach(() => {
  useAuthMock.mockReset();
  useGetEffectiveMock.mockReset();
  // Zustand stores are module singletons; reset to the initial cold state
  // so state never leaks between tests.
  __modulesStoreForTests.setState({
    modules: { ...CLIENT_MODULE_DEFAULTS },
    isLoading: true,
    isPlaceholder: true,
  });
});

describe('modules store — default snapshot without a sync host', () => {
  it('returns the manifest default for every module before sync mounts', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false });
    useGetEffectiveMock.mockReturnValue({ data: undefined, isLoading: false });

    function Probe() {
      const active = useIsModuleActive('copilot');
      return <span data-testid="copilot">{active ? 'on' : 'off'}</span>;
    }
    render(<Probe />);
    // copilot defaults to true in the manifest.
    expect(screen.getByTestId('copilot')).toHaveTextContent('on');
  });
});

describe('ModulesSync — defaults during boot', () => {
  it('keeps the manifest default (true) for every demo module while the query is loading', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true });
    useGetEffectiveMock.mockReturnValue({ data: undefined, isLoading: true });

    function Probe() {
      const snapshot = useModulesSnapshot();
      return (
        <div>
          <span data-testid="copilot">{snapshot.modules.copilot ? 'on' : 'off'}</span>
          <span data-testid="quotations">{snapshot.modules.quotations ? 'on' : 'off'}</span>
          <span data-testid="placeholder">{snapshot.isPlaceholder ? 'yes' : 'no'}</span>
          <span data-testid="loading">{snapshot.isLoading ? 'yes' : 'no'}</span>
        </div>
      );
    }

    render(
      <>
        <ModulesSync />
        <Probe />
      </>
    );
    expect(screen.getByTestId('copilot')).toHaveTextContent('on');
    expect(screen.getByTestId('quotations')).toHaveTextContent('on');
    expect(screen.getByTestId('placeholder')).toHaveTextContent('yes');
    expect(screen.getByTestId('loading')).toHaveTextContent('yes');
  });
});

describe('ModulesSync — server response', () => {
  it('reflects the server response (toggling copilot off)', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true });
    useGetEffectiveMock.mockReturnValue({
      data: {
        modules: {
          copilot: false,
          'operations-center': true,
          quotations: true,
          'anomaly-detection': true,
          'semantic-search': true,
        },
      },
      isLoading: false,
    });

    function Probe() {
      const snapshot = useModulesSnapshot();
      return (
        <div>
          <span data-testid="copilot">{snapshot.modules.copilot ? 'on' : 'off'}</span>
          <span data-testid="placeholder">{snapshot.isPlaceholder ? 'yes' : 'no'}</span>
        </div>
      );
    }

    render(
      <>
        <ModulesSync />
        <Probe />
      </>
    );
    expect(screen.getByTestId('copilot')).toHaveTextContent('off');
    expect(screen.getByTestId('placeholder')).toHaveTextContent('no');
  });

  it('ignores unknown module ids in the response (forwards-compat)', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true });
    useGetEffectiveMock.mockReturnValue({
      data: {
        modules: {
          copilot: true,
          'future-module': false,
        },
      },
      isLoading: false,
    });

    function Probe() {
      const snapshot = useModulesSnapshot();
      const keys = Object.keys(snapshot.modules).sort();
      return <span data-testid="keys">{keys.join(',')}</span>;
    }

    render(
      <>
        <ModulesSync />
        <Probe />
      </>
    );
    expect(screen.getByTestId('keys')).toHaveTextContent(
      // demo modules +  surface modules +
      // delivery — sorted before joining.
      'anomaly-detection,copilot,customer-display,delivery,events-api,kds,mobile-waiter,operations-center,pos-touch,quotations,semantic-search'
    );
  });
});

describe('ModulesSync — auth gating', () => {
  it('disables the underlying query while unauthenticated (avoid UNAUTHORIZED on /login)', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false });
    useGetEffectiveMock.mockReturnValue({ data: undefined, isLoading: false });

    render(<ModulesSync />);

    expect(useGetEffectiveMock).toHaveBeenCalled();
    const lastCall = useGetEffectiveMock.mock.calls[useGetEffectiveMock.mock.calls.length - 1];
    expect(lastCall![1]).toMatchObject({ enabled: false, refetchOnWindowFocus: false });
  });

  it('resets the snapshot to defaults when the session drops (logout)', () => {
    // Seed a non-default snapshot as if a tenant had loaded.
    __modulesStoreForTests.setState({
      modules: { ...CLIENT_MODULE_DEFAULTS, copilot: false },
      isLoading: false,
      isPlaceholder: false,
    });
    useAuthMock.mockReturnValue({ isAuthenticated: false });
    useGetEffectiveMock.mockReturnValue({ data: undefined, isLoading: false });

    function Probe() {
      const active = useIsModuleActive('copilot');
      return <span data-testid="copilot">{active ? 'on' : 'off'}</span>;
    }
    render(
      <>
        <ModulesSync />
        <Probe />
      </>
    );
    // The unauth branch reset() restores the manifest default (copilot=true).
    expect(screen.getByTestId('copilot')).toHaveTextContent('on');
  });
});
