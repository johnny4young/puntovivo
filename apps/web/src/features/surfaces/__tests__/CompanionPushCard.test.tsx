import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  statusUseQuery: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  invalidate: vi.fn(),
  role: 'manager' as string,
  supported: true,
  current: vi.fn(),
  subscribeBrowser: vi.fn(),
  language: 'es',
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ownerPush: {
      status: { useQuery: mocks.statusUseQuery },
      subscribe: { useMutation: () => ({ mutateAsync: mocks.subscribe }) },
      unsubscribe: { useMutation: () => ({ mutateAsync: mocks.unsubscribe }) },
    },
    useUtils: () => ({ ownerPush: { status: { invalidate: mocks.invalidate } } }),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: mocks.language, language: mocks.language },
  }),
}));

vi.mock('../companionPush', () => ({
  isPushSupported: () => mocks.supported,
  currentPushSubscription: mocks.current,
  subscribeBrowser: mocks.subscribeBrowser,
}));

import { CompanionPushCard } from '../CompanionPushCard';

const PAYLOAD = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p256dh', auth: 'auth' },
};
const browserSubscription = { endpoint: PAYLOAD.endpoint, unsubscribe: vi.fn() };

function status(data: Record<string, unknown> | undefined) {
  mocks.statusUseQuery.mockReturnValue({ data, isFetching: false });
}

const requestPermission = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'manager';
  mocks.supported = true;
  mocks.language = 'es';
  mocks.current.mockResolvedValue(null);
  mocks.subscribe.mockResolvedValue({ subscribed: true });
  mocks.unsubscribe.mockResolvedValue({ subscribed: false });
  mocks.subscribeBrowser.mockResolvedValue({ subscription: browserSubscription, payload: PAYLOAD });
  browserSubscription.unsubscribe.mockResolvedValue(true);
  requestPermission.mockResolvedValue('granted');
  vi.stubGlobal(
    'Notification',
    Object.assign(function Notification() {}, { permission: 'default', requestPermission })
  );
  status({ available: true, publicKey: 'server-key', subscribed: false, language: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderCard() {
  render(<CompanionPushCard />);
  await act(async () => {});
}

describe('CompanionPushCard', () => {
  it('stays hidden for roles that receive nothing, unsupported browsers and keyless servers', async () => {
    mocks.role = 'viewer';
    await renderCard();
    expect(screen.queryByTestId('companion-push')).toBeNull();

    mocks.role = 'manager';
    mocks.supported = false;
    await renderCard();
    expect(screen.queryByTestId('companion-push')).toBeNull();

    mocks.supported = true;
    status({ available: false, publicKey: null, subscribed: false, language: null });
    await renderCard();
    expect(screen.queryByTestId('companion-push')).toBeNull();
  });

  it('asks for permission, subscribes the browser and sends it with the current language', async () => {
    await renderCard();
    const toggle = screen.getByRole('switch', { name: 'push.title' });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mocks.subscribe).toHaveBeenCalledWith({ ...PAYLOAD, language: 'es' })
    );
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(mocks.subscribeBrowser).toHaveBeenCalledWith('server-key');
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.statusUseQuery).toHaveBeenLastCalledWith(
      { endpoint: PAYLOAD.endpoint },
      expect.objectContaining({ enabled: true })
    );
  });

  it('turns off on the server and in the browser', async () => {
    mocks.current.mockResolvedValue(browserSubscription);
    status({ available: true, publicKey: 'server-key', subscribed: true, language: 'es' });
    await renderCard();
    const toggle = screen.getByTestId('companion-push-toggle');
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() => expect(browserSubscription.unsubscribe).toHaveBeenCalled());
    expect(mocks.unsubscribe).toHaveBeenCalledWith({ endpoint: PAYLOAD.endpoint });
  });

  it('explains a browser block and keeps the switch off', async () => {
    requestPermission.mockResolvedValue('denied');
    await renderCard();
    fireEvent.click(screen.getByTestId('companion-push-toggle'));
    expect(await screen.findByTestId('companion-push-blocked')).toHaveTextContent('push.blocked');
    expect(screen.getByTestId('companion-push-toggle')).toBeDisabled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('re-reads the permission when the person returns from site settings', async () => {
    Object.assign(Notification, { permission: 'denied' });
    await renderCard();
    expect(screen.getByTestId('companion-push-toggle')).toBeDisabled();

    Object.assign(Notification, { permission: 'granted' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.queryByTestId('companion-push-blocked')).toBeNull();
    expect(screen.getByTestId('companion-push-toggle')).not.toBeDisabled();
  });

  it('drops the browser subscription when the server refuses it', async () => {
    mocks.subscribe.mockRejectedValue(new Error('offline'));
    await renderCard();
    fireEvent.click(screen.getByTestId('companion-push-toggle'));
    expect(await screen.findByTestId('companion-push-failed')).toHaveTextContent('push.failed');
    expect(browserSubscription.unsubscribe).toHaveBeenCalled();
  });

  it('re-sends the subscription when the language differs from the stored one', async () => {
    mocks.language = 'en';
    mocks.current.mockResolvedValue(browserSubscription);
    status({ available: true, publicKey: 'server-key', subscribed: true, language: 'es' });
    await renderCard();
    await waitFor(() =>
      expect(mocks.subscribe).toHaveBeenCalledWith({ ...PAYLOAD, language: 'en' })
    );
  });
});
