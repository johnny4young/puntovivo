/**
 * ENG-104 — CompanyReadinessCard tests.
 *
 * Pins the contract:
 *   - Loading skeleton renders during isLoading.
 *   - Error state renders + retry button visible when query errors.
 *   - Each section status maps to the right icon + status-data attr.
 *   - Score donut tone flips with thresholds (<50 danger, 50-79 warning, >=80 success).
 *   - Acknowledge button shows whenever acknowledgedAt is null.
 *
 * @module features/company/__tests__/CompanyReadinessCard.test
 */
import { fireEvent, render, screen } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { CompanyReadinessCard } from '../CompanyReadinessCard';
import { assertNoA11yViolations } from '@/test/a11y';

// ENG-179b — explicit `| undefined` on optional fields.
interface ReadinessQueryState {
  data?:
    | {
        score: number;
        blockerCount: number;
        sections: Array<{
          id: string;
          status: string;
          cta: { route: string; tab?: string | undefined } | null;
        }>;
        acknowledgedAt: string | null;
      }
    | undefined;
  isLoading: boolean;
  error: { message: string } | null;
  refetch: () => Promise<void>;
}

const readinessQueryRef: { current: ReadinessQueryState } = {
  current: {
    data: undefined,
    isLoading: true,
    error: null,
    refetch: vi.fn(async () => undefined),
  },
};

const acknowledgeMutate = vi.fn();
const acknowledgeState = { isPending: false };

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      setupReadiness: { get: { invalidate: vi.fn(async () => undefined) } },
    }),
    setupReadiness: {
      get: {
        useQuery: () => readinessQueryRef.current,
      },
    },
    companies: {
      acknowledgeSetup: {
        useMutation: (opts: { onSuccess?: () => Promise<void> | void }) => ({
          mutate: () => {
            acknowledgeMutate();
            void opts.onSuccess?.();
          },
          isPending: acknowledgeState.isPending,
        }),
      },
    },
  },
}));

function sampleSections() {
  return [
    { id: 'locale', status: 'ready', cta: { route: '/company', tab: 'locale' } },
    { id: 'sites', status: 'ready', cta: { route: '/sites' } },
    { id: 'fiscal', status: 'blocker', cta: { route: '/company', tab: 'fiscal' } },
    {
      id: 'peripherals',
      status: 'optional-pending',
      cta: { route: '/company', tab: 'device' },
    },
    { id: 'payments', status: 'ready', cta: { route: '/company', tab: 'payments' } },
    { id: 'modules', status: 'ready', cta: { route: '/company', tab: 'modules' } },
    { id: 'users', status: 'optional-pending', cta: { route: '/users' } },
    { id: 'ai', status: 'not-applicable', cta: null },
    { id: 'catalog', status: 'blocker', cta: { route: '/products' } },
    {
      id: 'cashSession',
      status: 'optional-pending',
      cta: { route: '/sales' },
    },
  ];
}

describe('CompanyReadinessCard (ENG-104)', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    acknowledgeMutate.mockReset();
    acknowledgeState.isPending = false;
    readinessQueryRef.current = {
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(async () => undefined),
    };
  });

  it('renders the loading state while the query is fetching', () => {
    render(<CompanyReadinessCard />);
    // The shared PageLoadingState renders the title text we pass.
    expect(screen.getByText(/Setup readiness/i)).toBeInTheDocument();
  });

  it('renders the error state when the query fails', () => {
    readinessQueryRef.current = {
      data: undefined,
      isLoading: false,
      error: { message: 'boom' },
      refetch: vi.fn(async () => undefined),
    };
    render(<CompanyReadinessCard />);
    // QueryErrorState renders a retry button.
    expect(
      screen.getByRole('button', { name: /retry|reintentar/i })
    ).toBeInTheDocument();
  });

  it('passes axe-core WCAG 2 AA on the happy-render path (ENG-134)', async () => {
    readinessQueryRef.current = {
      data: {
        score: 80,
        blockerCount: 0,
        sections: sampleSections().map(s =>
          s.status === 'blocker' ? { ...s, status: 'ready' } : s
        ),
        acknowledgedAt: null,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    };
    const { container } = render(<CompanyReadinessCard />);
    await assertNoA11yViolations(container);
  });

  it('renders 10 sections with status-specific data attributes', () => {
    readinessQueryRef.current = {
      data: {
        score: 60,
        blockerCount: 2,
        sections: sampleSections(),
        acknowledgedAt: null,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    };
    render(<CompanyReadinessCard />);
    expect(
      screen.getByTestId('company-readiness-section-locale')
    ).toHaveAttribute('data-status', 'ready');
    expect(
      screen.getByTestId('company-readiness-section-fiscal')
    ).toHaveAttribute('data-status', 'blocker');
    expect(
      screen.getByTestId('company-readiness-section-ai')
    ).toHaveAttribute('data-status', 'not-applicable');
    // Blocker count badge is visible.
    expect(
      screen.getByTestId('company-readiness-blocker-count').textContent
    ).toMatch(/2/);
  });

  it('flips the score donut tone by threshold', () => {
    function readToneForScore(score: number): string | null {
      readinessQueryRef.current = {
        data: {
          score,
          blockerCount: score < 100 ? 1 : 0,
          sections: sampleSections(),
          acknowledgedAt: null,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(async () => undefined),
      };
      const { unmount, container } = render(<CompanyReadinessCard />);
      const tone = container
        .querySelector('[data-testid="company-readiness-score"]')
        ?.getAttribute('data-tone') ?? null;
      unmount();
      return tone;
    }

    expect(readToneForScore(30)).toBe('danger');
    expect(readToneForScore(60)).toBe('warning');
    expect(readToneForScore(92)).toBe('success');
  });

  it('shows the acknowledge button while setup is unacknowledged, even with blockers', () => {
    // Case 1: blockers > 0 + ackAt null → button visible + clickable.
    readinessQueryRef.current = {
      data: {
        score: 50,
        blockerCount: 2,
        sections: sampleSections(),
        acknowledgedAt: null,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    };
    const { unmount } = render(<CompanyReadinessCard />);
    const blockerAckButton = screen.getByTestId('company-readiness-acknowledge');
    expect(blockerAckButton).toBeInTheDocument();
    fireEvent.click(blockerAckButton);
    expect(acknowledgeMutate).toHaveBeenCalledTimes(1);
    unmount();

    // Case 2: blockers == 0 + ackAt null → button still visible + clickable.
    acknowledgeMutate.mockClear();
    readinessQueryRef.current = {
      data: {
        score: 100,
        blockerCount: 0,
        sections: sampleSections().map(s =>
          s.status === 'blocker' ? { ...s, status: 'ready' } : s
        ),
        acknowledgedAt: null,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    };
    render(<CompanyReadinessCard />);
    const ackButton = screen.getByTestId('company-readiness-acknowledge');
    expect(ackButton).toBeInTheDocument();
    fireEvent.click(ackButton);
    expect(acknowledgeMutate).toHaveBeenCalledTimes(1);
  });

  it('hides the acknowledge button once setup was acknowledged', () => {
    readinessQueryRef.current = {
      data: {
        score: 50,
        blockerCount: 2,
        sections: sampleSections(),
        acknowledgedAt: '2026-05-20T12:00:00.000Z',
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(async () => undefined),
    };

    render(<CompanyReadinessCard />);
    expect(
      screen.queryByTestId('company-readiness-acknowledge')
    ).not.toBeInTheDocument();
  });
});
