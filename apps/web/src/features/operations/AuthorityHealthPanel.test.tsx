/**
 * Tests for AuthorityHealthPanel.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/utils';
import { AuthorityHealthPanel } from './AuthorityHealthPanel';

const invalidateAuthorityStatus = vi.fn();
const createPairingMutate = vi.fn();
const revokeMutate = vi.fn();

const statusData = {
  runtime: {
    authorityMode: 'site_hub',
    hubUrl: null,
    siteId: 'site-1',
    deviceId: null,
    bindHost: '0.0.0.0',
    bindPort: 8090,
    allowedLanOrigins: ['http://192.168.1.10:3000'],
  },
  hub: {
    dbSchemaVersion: 21,
    activeDeviceCount: 2,
    tenantActiveDeviceCount: 2,
  },
  summary: {
    total: 2,
    online: 1,
    stale: 1,
    revoked: 0,
    hubClients: 1,
    authorityNodes: 1,
    webClients: 0,
  },
  devices: [
    {
      id: 'device-hub',
      name: 'Hub',
      kind: 'desktop',
      authorityRole: 'authority_node',
      pairedSiteId: 'site-1',
      pairedSiteName: 'Main',
      lastSeenAt: '2026-05-11T10:00:00.000Z',
      appVersion: '1.0.0',
      dbSchemaVersion: 21,
      healthStatus: 'online',
      isActive: true,
      createdAt: '2026-05-11T09:00:00.000Z',
    },
    {
      id: 'device-client',
      name: 'Caja 2',
      kind: 'hub_client',
      authorityRole: 'hub_client',
      pairedSiteId: 'site-1',
      pairedSiteName: 'Main',
      lastSeenAt: '2026-05-11T09:50:00.000Z',
      appVersion: '1.0.0',
      dbSchemaVersion: 21,
      healthStatus: 'stale',
      isActive: true,
      createdAt: '2026-05-11T09:10:00.000Z',
    },
  ],
  pairingCodes: [
    {
      id: 'pair-1',
      siteId: 'site-1',
      siteName: 'Main',
      deviceName: 'Caja 3',
      status: 'pending',
      expiresAt: '2026-05-11T10:10:00.000Z',
      claimedByDeviceId: null,
      claimedAt: null,
      createdAt: '2026-05-11T10:00:00.000Z',
    },
  ],
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      authority: { status: { invalidate: invalidateAuthorityStatus } },
    }),
    sites: {
      list: {
        useQuery: () => ({
          data: { items: [{ id: 'site-1', name: 'Main' }] },
        }),
      },
    },
    authority: {
      status: {
        useQuery: () => ({
          data: statusData,
          isLoading: false,
          isFetching: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      createPairingCode: {
        useMutation: ({ onSuccess }: { onSuccess: (result: unknown) => Promise<void> }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            createPairingMutate(input);
            void onSuccess({
              code: 'ABCD-2345',
              expiresAt: '2026-05-11T10:10:00.000Z',
              siteId: 'site-1',
            });
          },
        }),
      },
      revokeDevice: {
        useMutation: ({ onSuccess }: { onSuccess: () => Promise<void> }) => ({
          isPending: false,
          variables: null,
          mutate: (input: unknown) => {
            revokeMutate(input);
            void onSuccess();
          },
        }),
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'admin@demo.co', role: 'admin', tenantId: 't1' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('AuthorityHealthPanel', () => {
  it('renders topology summary and hub-client row', () => {
    render(<AuthorityHealthPanel />);

    expect(screen.getByText(/Store hub/i)).toBeInTheDocument();
    expect(screen.getByText('Caja 2')).toBeInTheDocument();
    expect(screen.getByText(/Hub client/i)).toBeInTheDocument();
    expect(screen.getByText(/Stale/i)).toBeInTheDocument();
  });

  it('creates a pairing code and surfaces the one-time value', async () => {
    render(<AuthorityHealthPanel />);

    fireEvent.change(screen.getByTestId('authority-pairing-device-name'), {
      target: { value: 'Caja 3' },
    });
    fireEvent.click(screen.getByTestId('authority-create-pairing-code'));

    expect(createPairingMutate).toHaveBeenCalledWith({
      siteId: 'site-1',
      deviceName: 'Caja 3',
      expiresInMinutes: 10,
    });
    expect(await screen.findByText('ABCD-2345')).toBeInTheDocument();
  });

  it('revokes a hub-client terminal after confirmation', async () => {
    render(<AuthorityHealthPanel />);

    fireEvent.click(screen.getByTestId('authority-revoke-device-client'));

    await waitFor(() => {
      expect(revokeMutate).toHaveBeenCalledWith({ deviceId: 'device-client' });
    });
  });
});
