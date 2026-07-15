import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  role: 'cashier' as 'cashier' | 'manager' | 'admin',
  approval: {
    views: [
      {
        action: 'cash_drawer_open' as const,
        requestId: 'approval-1',
        status: 'approved' as const,
        decisionReason: null,
      },
    ],
    approvalRequestId: 'approval-1' as string | null,
    allApproved: true,
    isLoading: false,
    error: null as Error | null,
    isRequesting: false,
    requestApproval: vi.fn(),
    refetch: vi.fn(),
  },
  kick: { mutateAsync: vi.fn(), isPending: false },
  bytes: { mutateAsync: vi.fn(), isPending: false },
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: mocks.role } }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-1', name: 'Central' } }),
}));

vi.mock('@/features/approvals/useManagerApproval', () => ({
  useManagerApproval: () => mocks.approval,
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) =>
    path === 'peripherals.kickCashDrawer' ? mocks.kick : mocks.bytes,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ managerApprovals: { mine: { invalidate: mocks.invalidate } } }),
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: mocks.success,
    error: mocks.error,
    info: vi.fn(),
  }),
}));

vi.mock('@/features/sales/receiptPrinter', () => ({
  dispatchDrawerKick: async ({ serverKick }: { serverKick: () => Promise<unknown> }) =>
    serverKick(),
}));

import { useCashDrawerController } from './useCashDrawerController';

describe('useCashDrawerController', () => {
  beforeEach(() => {
    mocks.role = 'cashier';
    mocks.kick.mutateAsync.mockReset().mockResolvedValue({ status: 'ok' });
    mocks.bytes.mutateAsync.mockReset();
    mocks.invalidate.mockReset().mockResolvedValue(undefined);
    mocks.success.mockReset();
    mocks.error.mockReset();
  });

  it('opens approval UI for a cashier and binds the consumed request to dispatch', async () => {
    const { result } = renderHook(() => useCashDrawerController({ hasRegisteredDrawer: true }));

    await act(async () => result.current.onKickCashDrawer?.());
    expect(result.current.approvalModal.isOpen).toBe(true);
    act(() => result.current.approvalModal.onConfirm());

    await waitFor(() => {
      expect(mocks.kick.mutateAsync).toHaveBeenCalledWith({
        siteId: 'site-1',
        approvalRequestId: 'approval-1',
      });
    });
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it('keeps the manager direct path grant-free', async () => {
    mocks.role = 'manager';
    const { result } = renderHook(() => useCashDrawerController({ hasRegisteredDrawer: true }));

    await act(async () => result.current.onKickCashDrawer?.());
    expect(result.current.approvalModal.isOpen).toBe(false);
    expect(mocks.kick.mutateAsync).toHaveBeenCalledWith({ siteId: 'site-1' });
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
