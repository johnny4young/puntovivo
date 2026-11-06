import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => <p>app mounted</p> }));

import { AppRoot } from './AppRoot';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppRoot desktop boot', () => {
  it('shows the boot spinner until the desktop server is up', async () => {
    let markReady!: () => void;
    const serverReady = new Promise<void>(resolve => {
      markReady = resolve;
    });
    vi.stubGlobal('electron', { runtime: { whenServerReady: () => serverReady } });

    render(<AppRoot />);
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText('app mounted')).not.toBeInTheDocument();

    await act(async () => markReady());
    expect(screen.getByText('app mounted')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('mounts the app at once outside Electron', () => {
    render(<AppRoot />);
    expect(screen.getByText('app mounted')).toBeInTheDocument();
  });
});
