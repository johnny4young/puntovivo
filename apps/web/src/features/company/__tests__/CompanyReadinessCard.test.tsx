import { act, fireEvent, render, screen } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';
import i18next from '@/i18n';
import { assertNoA11yViolations } from '@/test/a11y';
import { CompanyReadinessCard } from '../CompanyReadinessCard';
import type { CompanyReadiness } from '../companyGuidedSetup';

interface ReadinessQueryState {
  data?: CompanyReadiness | undefined;
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

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
        useMutation: (options: { onSuccess?: () => Promise<void> | void }) => ({
          mutate: () => {
            acknowledgeMutate();
            void options.onSuccess?.();
          },
          isPending: acknowledgeState.isPending,
        }),
      },
    },
  },
}));

function sampleSections(): CompanyReadiness['sections'] {
  return [
    { id: 'locale', status: 'ready', cta: { route: '/company', tab: 'locale' } },
    { id: 'sites', status: 'ready', cta: { route: '/sites' } },
    { id: 'fiscal', status: 'blocker', cta: { route: '/company', tab: 'fiscal' } },
    {
      id: 'peripherals',
      status: 'optional-pending',
      cta: { route: '/peripherals' },
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
    { id: 'sync', status: 'ready', cta: { route: '/operations' } },
  ];
}

function setReadiness(
  overrides: Partial<CompanyReadiness> = {}
): CompanyReadiness {
  const data: CompanyReadiness = {
    score: 60,
    blockerCount: 2,
    sections: sampleSections(),
    acknowledgedAt: null,
    ...overrides,
  };
  readinessQueryRef.current = {
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  };
  return data;
}

describe('CompanyReadinessCard', () => {
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

  it('renders loading and recoverable error states', () => {
    const { unmount } = render(<CompanyReadinessCard />);
    expect(screen.getByText(/Setup readiness/i)).toBeInTheDocument();
    unmount();

    readinessQueryRef.current = {
      data: undefined,
      isLoading: false,
      error: { message: 'boom' },
      refetch: vi.fn(async () => undefined),
    };
    render(<CompanyReadinessCard />);
    expect(screen.getByRole('button', { name: /retry|reintentar/i })).toBeInTheDocument();
  });

  it('shows five approachable areas and only the next required decision', () => {
    setReadiness();
    render(<CompanyReadinessCard />);

    for (const step of ['business', 'selling', 'fiscal', 'payments', 'devices']) {
      expect(screen.getByTestId(`company-guided-step-${step}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('company-guided-step-selling')).toHaveAttribute(
      'data-status',
      'blocker'
    );
    expect(screen.getByTestId('company-guided-step-business')).toHaveAttribute(
      'data-status',
      'ready'
    );
    expect(screen.getByTestId('company-readiness-cta-catalog')).toBeInTheDocument();
    expect(screen.queryByTestId('company-readiness-cta-fiscal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('company-readiness-acknowledge')).not.toBeInTheDocument();
    expect(screen.queryByText('AI features')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync')).not.toBeInTheDocument();
  });

  it('lets the operator inspect an optional area without exposing the full matrix', () => {
    setReadiness({
      blockerCount: 0,
      sections: sampleSections().map(section =>
        section.status === 'blocker' ? { ...section, status: 'ready' } : section
      ),
    });
    render(<CompanyReadinessCard />);

    fireEvent.click(screen.getByTestId('company-guided-step-devices'));

    expect(screen.getByTestId('company-guided-detail-devices')).toBeInTheDocument();
    expect(screen.getByText('Peripherals')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure if needed' })).toBeInTheDocument();
  });

  it('normalizes the legacy readiness tab before selecting a guided step', () => {
    setReadiness({
      blockerCount: 0,
      sections: sampleSections().map(section =>
        section.status === 'blocker' ? { ...section, status: 'ready' } : section
      ),
    });
    render(
      <>
        <CompanyReadinessCard />
        <LocationProbe />
      </>,
      { initialEntries: ['/company?tab=readiness'] }
    );

    fireEvent.click(screen.getByTestId('company-guided-step-devices'));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/company?step=devices');
  });

  it('acknowledges setup only after required blockers are resolved', async () => {
    setReadiness({
      blockerCount: 0,
      score: 90,
      sections: sampleSections().map(section =>
        section.status === 'blocker' ? { ...section, status: 'ready' } : section
      ),
    });
    render(<CompanyReadinessCard />);

    expect(screen.getByTestId('company-readiness-ready')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('company-readiness-acknowledge'));
    });
    expect(acknowledgeMutate).toHaveBeenCalledOnce();
  });

  it('keeps the sales continuation available after setup was acknowledged', () => {
    setReadiness({
      blockerCount: 0,
      acknowledgedAt: '2026-07-28T12:00:00.000Z',
      sections: sampleSections().map(section =>
        section.status === 'blocker' ? { ...section, status: 'ready' } : section
      ),
    });
    render(<CompanyReadinessCard />);

    expect(screen.queryByTestId('company-readiness-acknowledge')).not.toBeInTheDocument();
    expect(screen.getByTestId('company-readiness-continue')).toBeInTheDocument();
  });

  it('passes axe-core WCAG 2 AA on the guided happy path', async () => {
    setReadiness({
      blockerCount: 0,
      score: 90,
      sections: sampleSections().map(section =>
        section.status === 'blocker' ? { ...section, status: 'ready' } : section
      ),
    });
    const { container } = render(<CompanyReadinessCard />);
    await assertNoA11yViolations(container);
  });
});
