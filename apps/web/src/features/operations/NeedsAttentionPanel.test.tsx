/**
 * NeedsAttentionPanel tests.
 *
 * Pins:
 * - All-clear state when no area needs attention.
 * - A row per area with the localized label, count, and severity tone.
 * - The "Review" CTA calls onReviewArea with the area (deep-link seam).
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

vi.mock('@/lib/trpc', () => ({
  trpc: {
    operations: {
      needsAttention: {
        useQuery: () => mockState,
      },
    },
  },
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
  });

  it('shows the all-clear state when no areas need attention', () => {
    mockState = successState([]);
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} />);
    expect(screen.getByTestId('needs-attention-all-clear')).toBeInTheDocument();
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
    expect(screen.queryByTestId('needs-attention-list')).not.toBeInTheDocument();
  });

  it('renders a row per area with the count and severity tone', () => {
    mockState = successState([
      { area: 'fiscal', severity: 'danger', count: 3 },
      { area: 'sync', severity: 'warning', count: 26 },
    ]);
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} />);

    const fiscal = screen.getByTestId('needs-attention-row-fiscal');
    expect(fiscal).toHaveAttribute('data-severity', 'danger');
    expect(fiscal).toHaveTextContent(/Fiscal documents/i);
    expect(fiscal).toHaveTextContent(/3 items pending/i);

    const sync = screen.getByTestId('needs-attention-row-sync');
    expect(sync).toHaveAttribute('data-severity', 'warning');
    expect(sync).toHaveTextContent(/26 items pending/i);
  });

  it('calls onReviewArea with the area when Review is clicked', () => {
    const onReviewArea = vi.fn();
    mockState = successState([{ area: 'payments', severity: 'danger', count: 1 }]);
    render(<NeedsAttentionPanel onReviewArea={onReviewArea} />);
    fireEvent.click(screen.getByTestId('needs-attention-cta-payments'));
    expect(onReviewArea).toHaveBeenCalledWith('payments');
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
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} />);
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
    render(<NeedsAttentionPanel onReviewArea={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('has no serious accessibility violations', async () => {
    mockState = successState([{ area: 'device', severity: 'danger', count: 2 }]);
    const { container } = render(<NeedsAttentionPanel onReviewArea={vi.fn()} />);
    await assertNoA11yViolations(container);
  });
});
