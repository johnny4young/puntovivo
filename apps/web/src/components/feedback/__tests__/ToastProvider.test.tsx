import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import i18next from '@/i18n';
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

function ActionToastHarness({ onAction }: { onAction: () => void | Promise<void> }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.error({
          title: 'Session expired',
          description: 'Sign in again.',
          action: { label: 'Sign in again', onClick: onAction },
        });
      }}
    >
      Show action toast
    </button>
  );
}

describe('ToastProvider', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

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

  it('localizes the dismiss label when the active language is Spanish', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Show toast' }));
    await user.click(screen.getByRole('button', { name: /descartar provider saved/i }));

    expect(screen.queryByText('Provider saved')).not.toBeInTheDocument();
  });

  it('runs an accessible toast action and dismisses the notification', async () => {
    const user = userEvent.setup();
    let actions = 0;

    render(
      <ToastProvider>
        <ActionToastHarness
          onAction={() => {
            actions++;
          }}
        />
      </ToastProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Show action toast' }));
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(actions).toBe(1);
    expect(screen.queryByText('Session expired')).not.toBeInTheDocument();
  });

  it('contains a rejected async action and keeps recovery available', async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ActionToastHarness onAction={async () => Promise.reject(new Error('recovery failed'))} />
      </ToastProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Show action toast' }));
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(screen.getByText('Session expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  });
});
