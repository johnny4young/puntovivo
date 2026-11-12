import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import {
  __resetEmbeddedServerStateForTests,
  useEmbeddedServerState,
} from '@/hooks/useEmbeddedServerState';
import type { EmbeddedServerState } from '@/types/electron';
import { EmbeddedServerRecovery } from './EmbeddedServerRecovery';

function StateProbe() {
  return <p data-testid="server-state">{useEmbeddedServerState()}</p>;
}

describe('EmbeddedServerRecovery', () => {
  let push: (state: EmbeddedServerState) => void = () => {};
  const originalElectron = window.electron;

  beforeEach(() => {
    __resetEmbeddedServerStateForTests();
    window.electron = {
      getServerState: vi.fn(async () => 'running' as const),
      onServerStateChange: vi.fn(listener => {
        push = listener;
        return () => {};
      }),
    } as unknown as typeof window.electron;
  });

  afterEach(() => {
    window.electron = originalElectron;
    __resetEmbeddedServerStateForTests();
  });

  it('follows the pushed state and refreshes every query once the server is back', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <StateProbe />
          <EmbeddedServerRecovery />
        </ToastProvider>
      </QueryClientProvider>
    );

    act(() => push('restarting'));
    expect(screen.getByTestId('server-state')).toHaveTextContent('restarting');
    expect(invalidate).not.toHaveBeenCalled();

    act(() => push('running'));
    expect(screen.getByTestId('server-state')).toHaveTextContent('running');
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/The system recovered|El sistema se recuperó/)
    ).toBeInTheDocument();
  });

  it('stays running and silent in the web build', () => {
    window.electron = undefined;
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <StateProbe />
          <EmbeddedServerRecovery />
        </ToastProvider>
      </QueryClientProvider>
    );
    expect(screen.getByTestId('server-state')).toHaveTextContent('running');
    expect(invalidate).not.toHaveBeenCalled();
  });
});
