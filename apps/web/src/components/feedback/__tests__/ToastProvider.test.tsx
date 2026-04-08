import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../ToastProvider';

function ToastHarness() {
  const toast = useToast();

  return (
    <button
      type="button"
      onClick={() => {
        toast.success({
          title: 'Provider saved',
          description: 'The record is ready to use.',
          durationMs: 1000,
        });
      }}
    >
      Show toast
    </button>
  );
}

describe('ToastProvider', () => {
  it('renders and dismisses toast notifications', async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Show toast' }));

    expect(screen.getByText('Provider saved')).toBeInTheDocument();
    expect(screen.getByText('The record is ready to use.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /dismiss provider saved/i }));

    expect(screen.queryByText('Provider saved')).not.toBeInTheDocument();
  });
});
