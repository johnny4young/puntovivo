/**
 * ENG-190 — Tests for ProfitMarginReportPage.
 *
 * Asserts:
 *   - Loading state shows the localized loading copy.
 *   - Error state renders the translated fallback.
 *   - Summary tiles render revenue / COGS / gross profit / margin values.
 *   - The per-product table renders rows (name + sku + figures).
 *   - An empty product list surfaces the localized empty-state copy.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import { ProfitMarginReportPage } from './ProfitMarginReportPage';

interface MockSummary {
  revenue: number;
  cogs: number;
  cogsFromLots: number;
  cogsFromSnapshot: number;
  grossProfit: number;
  grossMarginPct: number;
  salesCount: number;
  lineCount: number;
}

interface MockData {
  summary: MockSummary;
  products: Array<{
    productId: string;
    name: string;
    sku: string;
    quantity: number;
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number;
  }>;
}

let mockData: MockData | null = null;
let mockLoading = false;
let mockError: { message: string } | null = null;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      profit: {
        margin: {
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
      revenue: 0,
      cogs: 0,
      cogsFromLots: 0,
      cogsFromSnapshot: 0,
      grossProfit: 0,
      grossMarginPct: 0,
      salesCount: 0,
      lineCount: 0,
    },
    products: [],
    ...overrides,
  };
}

describe('ProfitMarginReportPage', () => {
  it('renders the loading copy while the query resolves', () => {
    mockLoading = true;
    render(<ProfitMarginReportPage />);
    expect(screen.getByText(/Cargando|Loading/i)).toBeInTheDocument();
  });

  it('surfaces the translated error when the query fails', () => {
    mockError = { message: 'boom' };
    render(<ProfitMarginReportPage />);
    expect(screen.getByText(/No se pudo cargar|could not be loaded/i)).toBeInTheDocument();
  });

  it('renders the summary tiles with revenue, COGS, profit and margin', () => {
    mockData = makeData({
      summary: {
        revenue: 170,
        cogs: 63,
        cogsFromLots: 48,
        cogsFromSnapshot: 15,
        grossProfit: 107,
        grossMarginPct: 62.94,
        salesCount: 1,
        lineCount: 2,
      },
    });
    render(<ProfitMarginReportPage />);
    const summary = screen.getByTestId('margin-summary');
    expect(summary.textContent).toMatch(/170/);
    expect(summary.textContent).toMatch(/63/);
    expect(summary.textContent).toMatch(/107/);
    expect(summary.textContent).toContain('62.9%');
  });

  it('renders the per-product breakdown rows', () => {
    mockData = makeData({
      summary: {
        revenue: 170,
        cogs: 63,
        cogsFromLots: 48,
        cogsFromSnapshot: 15,
        grossProfit: 107,
        grossMarginPct: 62.94,
        salesCount: 1,
        lineCount: 2,
      },
      products: [
        {
          productId: 'p1',
          name: 'Lotted Widget',
          sku: 'LOT-1',
          quantity: 10,
          revenue: 120,
          cogs: 48,
          grossProfit: 72,
          grossMarginPct: 60,
        },
        {
          productId: 'p2',
          name: 'Plain Gadget',
          sku: 'PLN-1',
          quantity: 5,
          revenue: 50,
          cogs: 15,
          grossProfit: 35,
          grossMarginPct: 70,
        },
      ],
    });
    render(<ProfitMarginReportPage />);
    expect(screen.getByText('Lotted Widget')).toBeInTheDocument();
    expect(screen.getByText('Plain Gadget')).toBeInTheDocument();
    expect(screen.getByText(/LOT-1/)).toBeInTheDocument();
  });

  it('renders the empty state when there are no products', () => {
    mockData = makeData();
    render(<ProfitMarginReportPage />);
    expect(
      screen.getAllByText(/Sin ventas en este rango|No sales in this range/i).length
    ).toBeGreaterThan(0);
  });
});
