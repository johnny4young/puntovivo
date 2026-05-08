/**
 * ENG-068 — ModulesContext regression test.
 *
 * Pins the contract every gated route relies on:
 *   - Defaults applied while the query is loading (no flash).
 *   - Server response overrides defaults once it lands.
 *   - Unknown ids in the response are ignored (forwards-compat).
 *   - Disabled when not authenticated (avoid UNAUTHORIZED on /login).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';

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
  ModulesProvider,
  useIsModuleActive,
  useModulesSnapshot,
} from '../ModulesContext';

beforeEach(() => {
  useAuthMock.mockReset();
  useGetEffectiveMock.mockReset();
});

describe('useIsModuleActive — context guard', () => {
  it('throws a clear error when used outside ModulesProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useIsModuleActive('copilot'))).toThrow(
      /useModulesContext must be used within ModulesProvider/
    );
    consoleSpy.mockRestore();
  });
});

describe('ModulesProvider — defaults during boot', () => {
  it('returns the manifest default (true) for every demo module while the query is loading', () => {
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
      <ModulesProvider>
        <Probe />
      </ModulesProvider>
    );
    expect(screen.getByTestId('copilot')).toHaveTextContent('on');
    expect(screen.getByTestId('quotations')).toHaveTextContent('on');
    expect(screen.getByTestId('placeholder')).toHaveTextContent('yes');
    expect(screen.getByTestId('loading')).toHaveTextContent('yes');
  });
});

describe('ModulesProvider — server response', () => {
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
      <ModulesProvider>
        <Probe />
      </ModulesProvider>
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
      <ModulesProvider>
        <Probe />
      </ModulesProvider>
    );
    expect(screen.getByTestId('keys')).toHaveTextContent(
      // ENG-068 demo modules + ENG-069 surface modules — alphabetical
      // because Object.keys order on the snapshot is insertion order
      // (manifest tuple) but the test sorts before joining.
      'anomaly-detection,copilot,customer-display,events-api,kds,mobile-waiter,operations-center,pos-touch,quotations,semantic-search'
    );
  });
});

describe('ModulesProvider — auth gating', () => {
  it('disables the underlying query while unauthenticated (avoid UNAUTHORIZED on /login)', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false });
    useGetEffectiveMock.mockReturnValue({ data: undefined, isLoading: false });

    function Probe() {
      useModulesSnapshot();
      return null;
    }
    render(
      <ModulesProvider>
        <Probe />
      </ModulesProvider>
    );

    expect(useGetEffectiveMock).toHaveBeenCalled();
    const lastCall = useGetEffectiveMock.mock.calls[useGetEffectiveMock.mock.calls.length - 1];
    expect(lastCall![1]).toMatchObject({ enabled: false });
  });
});
