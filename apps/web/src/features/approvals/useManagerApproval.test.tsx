import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidate, mutation, query } = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutation: { mutate: vi.fn(), isPending: false },
  query: {
    data: [] as Array<{
      id: string;
      action: 'sale_refund' | 'sale_void';
      resourceType: string;
      resourceId: string | null;
      status: 'pending' | 'approved';
      decisionReason: string | null;
      approvalsCollected: number;
      requiredApprovals: number;
    }>,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ managerApprovals: { mine: { invalidate } } }),
    managerApprovals: { mine: { useQuery: () => query } },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => mutation,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { useManagerApproval } from './useManagerApproval';

describe('useManagerApproval', () => {
  beforeEach(() => {
    mutation.mutate.mockReset();
    mutation.isPending = false;
    query.data = [];
    query.isLoading = false;
    query.error = null;
    query.refetch.mockReset();
  });

  it('selects only the exact action and resource grant', () => {
    query.data = [
      {
        id: 'wrong-action',
        action: 'sale_void',
        resourceType: 'sale',
        resourceId: 'sale-1',
        status: 'approved',
        decisionReason: null,
        approvalsCollected: 1,
        requiredApprovals: 1,
      },
      {
        id: 'wrong-resource',
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: 'sale-2',
        status: 'approved',
        decisionReason: null,
        approvalsCollected: 1,
        requiredApprovals: 1,
      },
      {
        id: 'exact-grant',
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: 'sale-1',
        status: 'approved',
        decisionReason: 'Receipt verified',
        approvalsCollected: 2,
        requiredApprovals: 2,
      },
    ];

    const { result } = renderHook(() =>
      useManagerApproval({
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: 'sale-1',
        summary: { label: 'VTA-1', amount: 125, currencyCode: 'USD' },
        enabled: true,
      })
    );

    expect(result.current.approvalRequestId).toBe('exact-grant');
    expect(result.current.allApproved).toBe(true);
    expect(result.current.views[0]).toMatchObject({
      action: 'sale_refund',
      status: 'approved',
      decisionReason: 'Receipt verified',
      approvalsCollected: 2,
      requiredApprovals: 2,
    });
  });

  it('requests the exact server-owned resource with a trimmed reason', () => {
    const { result } = renderHook(() =>
      useManagerApproval({
        action: 'sale_refund',
        resourceType: 'sale',
        resourceId: 'sale-1',
        summary: { label: 'VTA-1', amount: 125, currencyCode: 'USD' },
        enabled: true,
      })
    );

    act(() => result.current.requestApproval('sale_refund', '  Customer request  '));
    expect(mutation.mutate).toHaveBeenCalledWith({
      action: 'sale_refund',
      reason: 'Customer request',
      resourceType: 'sale',
      resourceId: 'sale-1',
      summary: { label: 'VTA-1', amount: 125, currencyCode: 'USD' },
    });
  });
});
