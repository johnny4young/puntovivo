/**
 * NeedsAttentionPanel tests.
 *
 * Pins:
 * - All-clear state when no area needs attention.
 * - Every incident explains impact, sale safety, next action, and approval.
 * - Administrators receive real recovery controls.
 * - Managers receive a visible handoff without technical navigation.
 * - Loading skeleton + error-with-retry states.
 * - No serious axe violations.
 *
 * @module features/operations/NeedsAttentionPanel.test
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { assertNoA11yViolations } from '@/test/a11y';

interface AttentionEntry {
  area: 'sync' | 'fiscal' | 'device' | 'payments';
  severity: 'danger' | 'warning';
  count: number;
}

interface AttentionQueryState {
  data?:
    | {
        areas: AttentionEntry[];
        totalCount: number;
        highestSeverity: 'danger' | 'warning' | null;
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  refetch: () => void;
}

let mockState: AttentionQueryState;
let mockRole: 'admin' | 'manager' = 'admin';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    operations: {
      needsAttention: {
        useQuery: () => mockState,
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'operator@demo.co', role: mockRole, tenantId: 't1' },
  }),
}));

import { NeedsAttentionPanel } from './NeedsAttentionPanel';

function successState(areas: AttentionEntry[]): AttentionQueryState {
  return {
    data: {
      areas,
      totalCount: areas.reduce((sum, a) => sum + a.count, 0),
      highestSeverity: areas.some(a => a.severity === 'danger')
        ? 'danger'
        : areas.length > 0
          ? 'warning'
          : null,
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
  };
}

describe('NeedsAttentionPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    mockState = successState([]);
    mockRole = 'admin';
  });

  it('shows the all-clear state when no areas need attention', () => {
    mockState = successState([]);
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByTestId('needs-attention-all-clear')).toBeInTheDocument();
    expect(screen.getByText(/Everything is ready/i)).toBeInTheDocument();
    expect(screen.queryByTestId('needs-attention-list')).not.toBeInTheDocument();
  });

  it('explains impact, sale safety, recommendation, and approval per incident', () => {
    mockState = successState([
      { area: 'fiscal', severity: 'danger', count: 3 },
      { area: 'sync', severity: 'warning', count: 26 },
    ]);
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} onNavigate={vi.fn()} />);

    const fiscal = screen.getByTestId('needs-attention-row-fiscal');
    expect(fiscal).toHaveAttribute('data-severity', 'danger');
    expect(fiscal).toHaveTextContent(/Electronic invoice delivery/i);
    expect(fiscal).toHaveTextContent(/3 items need review/i);
    expect(fiscal).toHaveTextContent(/pending delivery or was rejected/i);
    expect(fiscal).toHaveTextContent(/sale remains saved/i);
    expect(fiscal).toHaveTextContent(/retry delivery without recreating the sale/i);
    expect(fiscal).toHaveTextContent(/Administrator/i);

    const sync = screen.getByTestId('needs-attention-row-sync');
    expect(sync).toHaveAttribute('data-severity', 'warning');
    expect(sync).toHaveTextContent(/26 items need review/i);
    expect(sync).toHaveTextContent(/Act now|Review soon/i);
  });

  it('opens administrator recovery areas inside their resolving panel', () => {
    const onReviewArea = vi.fn();
    mockState = successState([{ area: 'payments', severity: 'danger', count: 1 }]);
    render(<NeedsAttentionPanel onReviewArea={onReviewArea} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('needs-attention-cta-payments'));
    expect(onReviewArea).toHaveBeenCalledWith('payments');
    expect(screen.getByTestId('needs-attention-cta-payments')).toHaveTextContent(
      /Reconcile payment/i
    );
  });

  it('routes synchronization to the surface that can resolve conflicts', () => {
    const onNavigate = vi.fn();
    mockState = successState([{ area: 'sync', severity: 'danger', count: 1 }]);
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('needs-attention-cta-sync'));
    expect(onNavigate).toHaveBeenCalledWith('/company?tab=data');
    expect(screen.getByTestId('needs-attention-cta-sync')).toHaveTextContent(
      /Open sync recovery/i
    );
  });

  it('gives managers an administrator handoff without a recovery control', () => {
    mockRole = 'manager';
    mockState = successState([{ area: 'payments', severity: 'danger', count: 1 }]);
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByTestId('needs-attention-handoff-payments')).toHaveTextContent(
      /Ask an administrator to continue/i
    );
    expect(screen.queryByTestId('needs-attention-cta-payments')).not.toBeInTheDocument();
    expect(screen.getByTestId('needs-attention-row-payments')).toHaveTextContent(
      /Verify the payment before charging again/i
    );
  });

  it('renders the loading skeleton while fetching', () => {
    mockState = {
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByTestId('needs-attention-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('needs-attention-list')).not.toBeInTheDocument();
  });

  it('renders the error state with a working retry', () => {
    const refetch = vi.fn();
    mockState = {
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      error: new Error('boom'),
      refetch,
    };
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('has no serious accessibility violations', async () => {
    mockState = successState([{ area: 'device', severity: 'danger', count: 2 }]);
    const { container } = render(
      <NeedsAttentionPanel onReviewArea={vi.fn()} onNavigate={vi.fn()} />
    );
    await assertNoA11yViolations(container);
  });
});
