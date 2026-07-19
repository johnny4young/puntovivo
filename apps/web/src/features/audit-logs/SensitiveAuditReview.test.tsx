import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { render } from '@/test/utils';
import { SensitiveAuditReview, type SensitiveAuditCategorySummary } from './SensitiveAuditReview';

const categories: SensitiveAuditCategorySummary[] = [
  { category: 'privacy', count: 2, latestAt: '2026-01-11T10:00:00.000Z' },
  { category: 'access', count: 1, latestAt: '2026-01-12T10:00:00.000Z' },
  { category: 'money', count: 1, latestAt: '2026-01-13T10:00:00.000Z' },
  { category: 'inventory', count: 1, latestAt: '2026-01-15T10:00:00.000Z' },
  { category: 'ai', count: 0, latestAt: null },
];

function renderReview(overrides: Partial<React.ComponentProps<typeof SensitiveAuditReview>> = {}) {
  const props: React.ComponentProps<typeof SensitiveAuditReview> = {
    total: 5,
    categories,
    selectedCategory: null,
    isLoading: false,
    error: null,
    onSelectCategory: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };

  return { ...render(<SensitiveAuditReview {...props} />), props };
}

describe('SensitiveAuditReview', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('presents stable risk categories, aggregate counts, and empty states', () => {
    renderReview();

    expect(screen.getByRole('heading', { name: 'Sensitive activity review' })).toBeInTheDocument();
    expect(screen.getByText('5 sensitive events')).toBeInTheDocument();
    expect(screen.getByTestId('audit-review-privacy')).toHaveTextContent('Privacy and data');
    expect(screen.getByTestId('audit-review-privacy')).toHaveTextContent('2');
    expect(screen.getByTestId('audit-review-ai')).toHaveTextContent('No events in this range');
  });

  it('uses pressed-state buttons to select, toggle, and clear a category', async () => {
    const user = userEvent.setup();
    const onSelectCategory = vi.fn();
    const { rerender } = renderReview({ onSelectCategory });

    await user.click(screen.getByTestId('audit-review-privacy'));
    expect(onSelectCategory).toHaveBeenLastCalledWith('privacy');

    rerender(
      <SensitiveAuditReview
        total={5}
        categories={categories}
        selectedCategory="privacy"
        isLoading={false}
        error={null}
        onSelectCategory={onSelectCategory}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByTestId('audit-review-privacy')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Clear review filter' }));
    expect(onSelectCategory).toHaveBeenLastCalledWith(null);
    await user.click(screen.getByTestId('audit-review-privacy'));
    expect(onSelectCategory).toHaveBeenLastCalledWith(null);
  });

  it('announces loading and exposes a recoverable summary failure', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onSelectCategory = vi.fn();
    const { rerender } = renderReview({ isLoading: true });

    expect(screen.getByRole('status')).toHaveTextContent('Summarizing sensitive activity');

    rerender(
      <SensitiveAuditReview
        total={0}
        categories={[]}
        selectedCategory="privacy"
        isLoading={false}
        error={new Error('unavailable')}
        onSelectCategory={onSelectCategory}
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to summarize sensitive activity');
    expect(screen.getByText('History filtered to Privacy and data.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear review filter' }));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
