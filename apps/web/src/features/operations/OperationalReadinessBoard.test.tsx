import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';

const mockAttentionQuery = {
  data: {
    areas: [{ area: 'fiscal' as const, severity: 'danger' as const, count: 2 }],
    totalCount: 2,
    highestSeverity: 'danger' as const,
  },
  isLoading: false,
  isError: false,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    operations: {
      needsAttention: {
        useQuery: () => mockAttentionQuery,
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}));

import { OperationalReadinessBoard } from './OperationalReadinessBoard';

describe('OperationalReadinessBoard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    delete window.electron;
  });

  afterEach(() => {
    delete window.electron;
  });

  it('shows six owned services with explicit status, target, threshold, and drill evidence', () => {
    render(<OperationalReadinessBoard onReviewArea={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getAllByTestId(/^operational-service-/)).toHaveLength(6);
    expect(screen.getByTestId('operational-service-fiscal')).toHaveAttribute(
      'data-status',
      'action_required'
    );
    expect(screen.getByTestId('operational-service-fiscal')).toHaveTextContent(/Store manager/i);
    expect(screen.getByTestId('operational-service-fiscal')).toHaveTextContent(/15 min/i);
    expect(screen.getByTestId('operational-service-backup')).toHaveAttribute(
      'data-status',
      'unavailable'
    );
    expect(screen.getByText(/7 executable drills/i)).toBeInTheDocument();
  });

  it('routes each server service to the surface that can actually recover it', () => {
    const onReviewArea = vi.fn();
    const onNavigate = vi.fn();
    render(<OperationalReadinessBoard onReviewArea={onReviewArea} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTestId('operational-action-fiscal'));
    expect(onReviewArea).toHaveBeenCalledWith('fiscal');
    fireEvent.click(screen.getByTestId('operational-action-sync'));
    expect(onNavigate).toHaveBeenCalledWith('/company?tab=data');
  });

  it('does not promise device-local controls from the web runtime', () => {
    render(<OperationalReadinessBoard onReviewArea={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByTestId('operational-desktop-required-backup')).toHaveTextContent(
      /Desktop app required/i
    );
    expect(screen.getByTestId('operational-desktop-required-updates')).toHaveTextContent(
      /Desktop app required/i
    );
    expect(screen.getByTestId('operational-desktop-required-backup')).toHaveClass(
      'ml-auto',
      'max-w-full',
      'text-center'
    );
    expect(screen.getByTestId('operational-desktop-required-backup').parentElement).toHaveClass(
      'flex-wrap'
    );
    expect(screen.queryByTestId('operational-action-backup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('operational-action-updates')).not.toBeInTheDocument();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(
      <OperationalReadinessBoard onReviewArea={vi.fn()} onNavigate={vi.fn()} />
    );
    await assertNoA11yViolations(container);
  });
});
