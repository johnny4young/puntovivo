/**
 * WorkspaceLandingPage contract tests.
 *
 * Pins the role/module filtering + redirect/link semantics of the
 * generic landing component used by `/catalog`, `/procurement`, and
 * `/finance`.
 *
 * @module features/workspaces/__tests__/WorkspaceLandingPage.test
 */
import { render, screen } from '@/test/utils';
import { Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceLandingPage } from '../WorkspaceLandingPage';

let mockUserRole: 'admin' | 'manager' | 'cashier' | 'viewer' = 'admin';
const allModulesOn = {
  copilot: true,
  'operations-center': true,
  quotations: true,
  delivery: true,
  'pos-touch': true,
  kds: true,
  'customer-display': true,
  'mobile-waiter': true,
  'anomaly-detection': true,
};
let mockModules: Record<string, boolean> = { ...allModulesOn };

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: `${mockUserRole}@example.com`,
      role: mockUserRole,
      tenantId: 'tenant-1',
    },
  }),
}));

vi.mock('@/features/modules', async () => {
  const actual = await vi.importActual<typeof import('@/features/modules')>('@/features/modules');
  return {
    ...actual,
    useModulesSnapshot: () => ({
      modules: mockModules,
      isLoading: false,
      isPlaceholder: false,
    }),
  };
});

beforeEach(() => {
  mockUserRole = 'admin';
  mockModules = { ...allModulesOn };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkspaceLandingPage', () => {
  it('admin with every module on sees all nine catalog items', () => {
    render(<WorkspaceLandingPage workspaceId="catalog" />);
    expect(screen.getByTestId('workspace-landing-catalog')).toBeInTheDocument();
    // Catalog declares: products, categories, providers, locations,
    // units, vatRates, customerCatalogs, geography, receiptTemplates.
    const expectedHrefs = [
      '/products',
      '/categories',
      '/providers',
      '/locations',
      '/units',
      '/vat-rates',
      '/customer-catalogs',
      '/geography',
      '/receipt-templates',
    ];
    for (const href of expectedHrefs) {
      const link = screen.getByRole('link', { name: new RegExp(extractItemLabel(href), 'i') });
      expect(link.getAttribute('href')).toBe(href);
    }
  });

  it('manager sees only the items their role permits (Products)', () => {
    mockUserRole = 'manager';
    render(<WorkspaceLandingPage workspaceId="catalog" />);
    // The other 8 catalog items are gated to adminOnlyRoles.
    expect(screen.getByRole('link', { name: /products/i }).getAttribute('href')).toBe('/products');
    expect(screen.queryByRole('link', { name: /^categories$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^providers$/i })).not.toBeInTheDocument();
  });

  it('hides procurement items whose module is off', () => {
    mockModules = { ...allModulesOn, quotations: false, delivery: false };
    render(<WorkspaceLandingPage workspaceId="procurement" />);
    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /purchases/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /quotations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /delivery/i })).not.toBeInTheDocument();
  });

  it('redirects to /dashboard when the workspaceId is unknown', () => {
    render(
      <Routes>
        <Route path="/" element={<WorkspaceLandingPage workspaceId="does-not-exist" />} />
        <Route path="/dashboard" element={<div data-testid="dashboard-placeholder" />} />
      </Routes>
    );
    expect(screen.getByTestId('dashboard-placeholder')).toBeInTheDocument();
  });

  it('redirects to /dashboard when no items are visible (cashier on finance)', () => {
    mockUserRole = 'cashier';
    render(
      <Routes>
        <Route path="/" element={<WorkspaceLandingPage workspaceId="finance" />} />
        <Route path="/dashboard" element={<div data-testid="dashboard-placeholder" />} />
      </Routes>
    );
    expect(screen.getByTestId('dashboard-placeholder')).toBeInTheDocument();
  });

  it('renders each item as an anchor link (not a button) for screen reader + cmd+click parity', () => {
    render(<WorkspaceLandingPage workspaceId="finance" />);
    const productsLink = screen.getByRole('link', { name: /fiscal documents/i });
    expect(productsLink.tagName).toBe('A');
    expect(productsLink.getAttribute('href')).toBe('/fiscal-documents');
  });
});

/**
 * Map catalog href → expected accessible label fragment. Kept narrow
 * to avoid coupling tests to wording shifts in `nav.json`.
 */
function extractItemLabel(href: string): string {
  switch (href) {
    case '/products':
      return 'Products';
    case '/categories':
      return 'Categories';
    case '/providers':
      return 'Providers';
    case '/locations':
      return 'Locations';
    case '/units':
      return 'Units';
    case '/vat-rates':
      return 'VAT Rates';
    case '/customer-catalogs':
      return 'Customer Catalogs';
    case '/geography':
      return 'Geography';
    case '/receipt-templates':
      return 'Receipt templates';
    default:
      return href.replace(/^\//, '');
  }
}
