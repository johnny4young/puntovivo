import { cleanup, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary, RouteErrorBoundary } from '../AppErrorBoundary';
import {
  __resetRenderObservabilityForTests,
  registerRenderTelemetrySink,
} from '@/lib/observability';

describe('AppErrorBoundary', () => {
  afterEach(async () => {
    cleanup();
    __resetRenderObservabilityForTests();
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
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
    expect(screen.queryByText('Render failed')).not.toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText('Recovered view')).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });

  it('routes render-tree errors through captureRenderError', () => {
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
    expect(typeof context.componentStack === 'string' || context.componentStack === null).toBe(
      true
    );
    consoleErrorSpy.mockRestore();
  });
});

describe.each([
  { language: 'en', title: 'Something went wrong', retry: 'Retry', reload: 'Reload App' },
  {
    language: 'es',
    title: 'Algo salió mal',
    retry: 'Reintentar',
    reload: 'Recargar la aplicación',
  },
])('safe boundary copy in $language', ({ language, title, retry, reload }) => {
  afterEach(async () => {
    cleanup();
    __resetRenderObservabilityForTests();
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it.each([
    { variant: 'app', Boundary: AppErrorBoundary },
    { variant: 'route', Boundary: RouteErrorBoundary },
  ])('keeps private diagnostics out of the $variant DOM and recovers', async ({ Boundary }) => {
    await i18n.changeLanguage(language);
    const user = userEvent.setup();
    const canaries = ['tenant-private-canary', '/private/customer.db', 'token=secret-canary'];
    const failure = new Error(canaries.join(' '));
    const capture = vi.fn();
    registerRenderTelemetrySink({ captureRenderError: capture });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    function ProblemChild() {
      if (broken) throw failure;
      return <p>Recovered screen</p>;
    }

    const { container } = render(
      <Boundary>
        <ProblemChild />
      </Boundary>
    );
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    expect(screen.getByRole('button', { name: reload })).toBeEnabled();
    // The app boundary may outlive ThemeProvider; its surface must follow global theme tokens.
    expect(container.querySelector('.bg-surface')).toBeInTheDocument();
    expect(container.querySelector('.bg-white')).not.toBeInTheDocument();
    for (const canary of canaries) expect(container.innerHTML).not.toContain(canary);
    expect(capture).toHaveBeenCalledExactlyOnceWith(
      failure,
      expect.objectContaining({ source: 'render' })
    );
    expect(consoleSpy).toHaveBeenCalled();

    broken = false;
    await user.tab();
    expect(screen.getByRole('button', { name: retry })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Recovered screen')).toBeVisible();
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

it('keeps the shell and its draft mounted when retrying a crashed route', async () => {
  const user = userEvent.setup();
  let broken = true;
  function ProblemChild() {
    if (broken) throw new Error('private route failure');
    return <p>Recovered route</p>;
  }
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(
      <>
        <nav aria-label="Store navigation">
          <a href="/sales">Sales</a>
        </nav>
        <label>
          Shell draft
          <input defaultValue="Keep me" />
        </label>
        <RouteErrorBoundary>
          <ProblemChild />
        </RouteErrorBoundary>
      </>
    );
    const draft = screen.getByRole('textbox', { name: 'Shell draft' });
    await user.type(draft, ' unchanged');
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('textbox', { name: 'Shell draft' })).toBe(draft);
    expect(draft).toHaveValue('Keep me unchanged');
    expect(screen.getByRole('navigation', { name: 'Store navigation' })).toBeVisible();
    expect(screen.getByText('Recovered route')).toBeVisible();
  } finally {
    consoleSpy.mockRestore();
  }
});
