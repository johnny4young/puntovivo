/**
 * Tests for CashHealthPanel.
 *
 * Asserts:
 * - Loading state shows the localized loading copy.
 * - Summary tiles render the four counters with the values from the
 * mocked reconciliation response.
 * - bySite + recentDiscrepancies tables render the rows.
 * - Empty arrays surface the localized empty-state copy.
 * - Error state renders the generic translated error.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import { CashHealthPanel } from './CashHealthPanel';

interface MockData {
  summary: {
    openSessionCount: number;
    closedRecentCount: number;
    reviewCount: number;
    netOverShort: number;
    largestDiscrepancy: number;
    windowDays: number;
  };
  bySite: Array<Record<string, unknown>>;
  recentDiscrepancies: Array<Record<string, unknown>>;
}

let mockData: MockData | null = null;
let mockLoading = false;
let mockError: { message: string } | null = null;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      cash: {
        reconciliation: {
          useQuery: () => ({
            data: mockData,
            isLoading: mockLoading,
            error: mockError,
          }),
        },
      },
    },
  },
}));

vi.mock('@/lib/translateServerError', () => ({
  translateServerError: (_error: unknown, _t: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  mockData = null;
  mockLoading = false;
  mockError = null;
});

function makeData(overrides: Partial<MockData> = {}): MockData {
  return {
    summary: {
      openSessionCount: 0,
      closedRecentCount: 0,
      reviewCount: 0,
      netOverShort: 0,
      largestDiscrepancy: 0,
      windowDays: 30,
    },
    bySite: [],
    recentDiscrepancies: [],
    ...overrides,
  };
}

describe('CashHealthPanel', () => {
  it('renders the loading copy while the query resolves', () => {
    mockLoading = true;
    render(<CashHealthPanel />);
    expect(screen.getByText(/Cargando|Loading/i)).toBeInTheDocument();
  });

  it('surfaces the generic error when the query fails', () => {
    mockError = { message: 'boom' };
    render(<CashHealthPanel />);
    // Shape of the page renders the rendered translateServerError fallback.
    expect(screen.getByText(/Algo salió mal|Something went wrong/i)).toBeInTheDocument();
  });

  it('renders the four summary tiles with values', () => {
    mockData = makeData({
      summary: {
        openSessionCount: 3,
        closedRecentCount: 12,
        reviewCount: 4,
        netOverShort: -27.5,
        largestDiscrepancy: 50,
        windowDays: 30,
      },
    });
    render(<CashHealthPanel />);
    const summary = screen.getByTestId('cash-summary');
    expect(summary.textContent).toContain('3'); // openSessions
    expect(summary.textContent).toContain('12'); // closedRecent
    // currency formatting depends on locale; just verify the digits land.
    expect(summary.textContent).toMatch(/27|27,5|27\.5/);
    expect(summary.textContent).toMatch(/50/);
  });

  it('renders the bySite table when sites are present', () => {
    mockData = makeData({
      summary: {
        openSessionCount: 2,
        closedRecentCount: 5,
        reviewCount: 1,
        netOverShort: 5,
        largestDiscrepancy: 5,
        windowDays: 30,
      },
      bySite: [
        {
          siteId: 'site-a',
          siteName: 'Sede Norte',
          openSessions: 1,
          closedSessions: 3,
          netOverShort: 5,
          overShortCount: 1,
        },
        {
          siteId: 'site-b',
          siteName: 'Sede Sur',
          openSessions: 1,
          closedSessions: 2,
          netOverShort: 0,
          overShortCount: 0,
        },
      ],
    });
    render(<CashHealthPanel />);
    expect(screen.getByText('Sede Norte')).toBeInTheDocument();
    expect(screen.getByText('Sede Sur')).toBeInTheDocument();
  });

  it('renders recent discrepancies when present', () => {
    mockData = makeData({
      summary: {
        openSessionCount: 0,
        closedRecentCount: 1,
        reviewCount: 1,
        netOverShort: -3.5,
        largestDiscrepancy: 3.5,
        windowDays: 30,
      },
      recentDiscrepancies: [
        {
          sessionId: 'sess-1',
          siteId: 'site-a',
          siteName: 'Sede Norte',
          registerName: 'Caja Norte',
          cashierName: 'Ana Cajera',
          closedAt: '2026-05-05T12:00:00.000Z',
          expectedBalance: 100,
          actualCount: 96.5,
          overShort: -3.5,
        },
      ],
    });
    render(<CashHealthPanel />);
    expect(screen.getByText('Caja Norte')).toBeInTheDocument();
    expect(screen.getByText('Ana Cajera')).toBeInTheDocument();
    // The site name appears in both the bySite section (when present) and
    // the discrepancies table; one match is enough for this assertion.
    expect(screen.getAllByText('Sede Norte').length).toBeGreaterThan(0);
  });

  it('renders both empty states when bySite and discrepancies are empty', () => {
    mockData = makeData();
    render(<CashHealthPanel />);
    // The bySite empty-state and the recentDiscrepancies empty-state copy both
    // exist in the rendered tree when their arrays are empty. The shared
    // EmptyState renders a title AND a description, so the site / discrepancy
    // wording can land in more than one node — assert at least one match each.
    expect(screen.getAllByText(/No hay sedes|No sites/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/No hay cierres con discrepancia|No closures with discrepancy/i).length
    ).toBeGreaterThan(0);
  });
});
