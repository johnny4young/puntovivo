import { fireEvent, render, screen } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';

import i18next from '@/i18n';
import { assertNoA11yViolations } from '@/test/a11y';
import { VerticalReadinessCard } from '../VerticalReadinessCard';

interface VerticalReadiness {
  businessType:
    | 'retail'
    | 'restaurant'
    | 'quickservice'
    | 'wholesale'
    | 'hardware'
    | 'butchery'
    | 'pharmacy'
    | null;
  profile: 'retail' | 'pharmacy' | 'hardware' | 'butchery' | 'restaurant' | null;
  checks: Array<{
    id:
      | 'catalog'
      | 'productUnits'
      | 'fractionalSales'
      | 'lotTracking'
      | 'serializedInventory'
      | 'weightedBarcode'
      | 'transformationRecipes'
      | 'pharmacyCatalog'
      | 'pharmacyPolicy'
      | 'pharmacyAuthorizations'
      | 'restaurantTables'
      | 'kdsStations'
      | 'customerDisplay';
    status: 'ready' | 'attention' | 'not-applicable';
    configuredCount: number;
    cta: { route: string; tab?: string } | null;
  }>;
  readyCount: number;
  attentionCount: number;
}

interface QueryState {
  data?: VerticalReadiness;
  isLoading: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
}

const queryRef: { current: QueryState } = {
  current: {
    isLoading: true,
    error: null,
    refetch: vi.fn(),
  },
};
const queryArgs: { current: unknown[] } = { current: [] };

vi.mock('@/lib/trpc', () => ({
  trpc: {
    setupReadiness: {
      vertical: {
        useQuery: (...args: unknown[]) => {
          queryArgs.current = args;
          return queryRef.current;
        },
      },
    },
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

function pharmacyReadiness(): VerticalReadiness {
  return {
    businessType: 'pharmacy',
    profile: 'pharmacy',
    readyCount: 2,
    attentionCount: 1,
    checks: [
      {
        id: 'catalog',
        status: 'ready',
        configuredCount: 27,
        cta: { route: '/products' },
      },
      {
        id: 'pharmacyPolicy',
        status: 'attention',
        configuredCount: 14,
        cta: { route: '/inventory?view=pharmacy' },
      },
      {
        id: 'customerDisplay',
        status: 'not-applicable',
        configuredCount: 0,
        cta: null,
      },
      {
        id: 'pharmacyAuthorizations',
        status: 'ready',
        configuredCount: 1,
        cta: { route: '/company', tab: 'modules' },
      },
    ],
  };
}

function setData(data: VerticalReadiness): void {
  queryRef.current = {
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe('VerticalReadinessCard', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    queryRef.current = {
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    };
    queryArgs.current = [];
  });

  it('always refreshes when the operator returns from a configuration surface', () => {
    setData(pharmacyReadiness());
    render(<VerticalReadinessCard />);

    expect(queryArgs.current).toEqual([
      undefined,
      {
        staleTime: 0,
        refetchOnMount: 'always',
      },
    ]);
  });

  it('renders loading and a retryable error without exposing internal details', () => {
    const { unmount } = render(<VerticalReadinessCard />);
    expect(screen.getByText('Vertical readiness')).toBeInTheDocument();
    unmount();

    const refetch = vi.fn();
    queryRef.current = {
      isLoading: false,
      error: Object.assign(new Error('SQLITE_PRIVATE_DETAIL'), {
        data: { code: 'INTERNAL_SERVER_ERROR' },
      }),
      refetch,
    };
    render(<VerticalReadinessCard />);
    expect(screen.queryByText('SQLITE_PRIVATE_DETAIL')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('asks for a business type instead of inventing a vertical', () => {
    setData({
      businessType: null,
      profile: null,
      checks: [],
      readyCount: 0,
      attentionCount: 0,
    });
    render(<VerticalReadinessCard />);

    expect(screen.getByText(/Choose a business type above/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows factual counts, attention and optional states with safe deep links', () => {
    setData(pharmacyReadiness());
    render(
      <>
        <VerticalReadinessCard />
        <LocationProbe />
      </>,
      { initialEntries: ['/company?tab=readiness'] }
    );

    expect(screen.getByText('Pharmacy operating checklist')).toBeInTheDocument();
    expect(screen.getByText('2 ready')).toBeInTheDocument();
    expect(screen.getByText('1 to review')).toBeInTheDocument();
    expect(screen.getByTestId('vertical-readiness-customerDisplay')).toHaveTextContent('Optional');
    expect(
      screen.queryByTestId('vertical-readiness-action-customerDisplay')
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('vertical-readiness-action-pharmacyPolicy'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/inventory?view=pharmacy');
  });

  it('appends a tab CTA without dropping an existing query', () => {
    const data = pharmacyReadiness();
    data.checks[3]!.cta = { route: '/company?step=business', tab: 'modules' };
    setData(data);
    render(
      <>
        <VerticalReadinessCard />
        <LocationProbe />
      </>
    );

    fireEvent.click(screen.getByTestId('vertical-readiness-action-pharmacyAuthorizations'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/company?step=business&tab=modules'
    );
  });

  it('uses neutral Latin American Spanish and passes axe on the populated card', async () => {
    await i18next.changeLanguage('es');
    setData(pharmacyReadiness());
    const { container } = render(<VerticalReadinessCard />);

    expect(screen.getByText('Lista operativa para droguería o farmacia')).toBeInTheDocument();
    expect(screen.getByText(/configuración actual del negocio/i)).toBeInTheDocument();
    await assertNoA11yViolations(container);
  });
});
