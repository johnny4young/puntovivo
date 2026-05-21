import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../AppErrorBoundary';
import {
  __resetRenderObservabilityForTests,
  registerRenderTelemetrySink,
} from '@/lib/observability';

describe('AppErrorBoundary', () => {
  afterEach(() => {
    __resetRenderObservabilityForTests();
  });

  it('renders a fallback and retries by remounting the subtree', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;

    function ProblemChild() {
      if (shouldThrow) {
        throw new Error('Render failed');
      }

      return <p>Recovered view</p>;
    }

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <ProblemChild />
      </AppErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Render failed')).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Recovered view')).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('routes render-tree errors through captureRenderError (ENG-135)', () => {
    const captureSpy = vi.fn();
    registerRenderTelemetrySink({ captureRenderError: captureSpy });

    function ProblemChild(): never {
      throw new Error('boom render');
    }

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <ProblemChild />
      </AppErrorBoundary>
    );

    expect(captureSpy).toHaveBeenCalledTimes(1);
    const [err, context] = captureSpy.mock.calls[0]!;
    expect((err as Error).message).toBe('boom render');
    expect(context).toMatchObject({ source: 'render' });
    expect(typeof context.componentStack === 'string' || context.componentStack === null).toBe(true);
    consoleErrorSpy.mockRestore();
  });
});
