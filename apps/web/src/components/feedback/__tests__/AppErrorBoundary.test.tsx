import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../AppErrorBoundary';

describe('AppErrorBoundary', () => {
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
});
