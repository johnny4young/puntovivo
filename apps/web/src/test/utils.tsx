import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import type { User, Tenant, TenantSettings, Product, SaleItem } from '@/types';

// ============================================================================
// Test Query Client
// ============================================================================

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// ============================================================================
// Mock Data Factories
// ============================================================================

let mockIdCounter = 0;

function generateMockId(): string {
  mockIdCounter += 1;
  return `mock-id-${mockIdCounter}`;
}

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: generateMockId(),
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    tenantId: 'tenant-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockTenantSettings(overrides?: Partial<TenantSettings>): TenantSettings {
  return {
    currency: 'USD',
    timezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    taxRate: 0.08,
    theme: 'light',
    ...overrides,
  };
}

export function createMockTenant(overrides?: Partial<Tenant>): Tenant {
  return {
    id: generateMockId(),
    name: 'Test Tenant',
    slug: 'test-tenant',
    settings: createMockTenantSettings(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockProduct(overrides?: Partial<Product>): Product {
  const id = generateMockId();
  return {
    id,
    tenantId: 'tenant-1',
    name: `Test Product ${id}`,
    sku: `SKU-${id}`,
    description: 'A test product description',
    categoryId: 'category-1',
    price: 29.99,
    price2: 34.99,
    price3: 39.99,
    cost: 15.0,
    marginPercent1: 99.93,
    marginPercent2: 133.27,
    marginPercent3: 166.6,
    marginAmount1: 14.99,
    marginAmount2: 19.99,
    marginAmount3: 24.99,
    taxRate: 0.08,
    vatRateId: 'vat-1',
    providerId: 'provider-1',
    locationId: 'shelf-a1',
    initialCost: 15.0,
    unitAssignments: [
      {
        id: 'unit-assignment-1',
        productId: id,
        unitId: 'unit-1',
        unitName: 'Unidad',
        unitAbbreviation: 'UND',
        equivalence: 1,
        price: 29.99,
        isBase: true,
      },
    ],
    stock: 100,
    minStock: 10,
    sellByFraction: false,
    fractionStep: null,
    fractionMinimum: null,
    isActive: true,
    barcode: `123456789${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockSaleItem(overrides?: Partial<SaleItem>): SaleItem {
  const id = generateMockId();
  const unitPrice = 29.99;
  const quantity = 2;
  const taxRate = 0.08;
  const discount = 0;
  const subtotal = unitPrice * quantity - discount;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;

  return {
    id,
    saleId: 'sale-1',
    productId: 'product-1',
    quantity,
    unitPrice,
    discount,
    taxRate,
    taxAmount,
    total,
    ...overrides,
  };
}

// ============================================================================
// All Providers Wrapper
// ============================================================================

// ENG-179b — explicit `| undefined` on optional fields.
interface AllProvidersProps {
  children: ReactNode;
  initialEntries?: string[] | undefined;
}

function AllProviders({ children, initialEntries = ['/'] }: AllProvidersProps) {
  const queryClient = createTestQueryClient();

  // Use MemoryRouter for tests to control navigation
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ============================================================================
// Custom Render Function
// ============================================================================

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
}

function customRender(ui: ReactElement, options?: CustomRenderOptions): ReturnType<typeof render> {
  const { initialEntries, ...renderOptions } = options ?? {};

  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders initialEntries={initialEntries}>{children}</AllProviders>
    ),
    ...renderOptions,
  });
}

// ============================================================================
// Simple Render (without providers)
// ============================================================================

function renderWithRouter(ui: ReactElement, { route = '/' } = {}): ReturnType<typeof render> {
  window.history.pushState({}, 'Test page', route);
  return render(ui, { wrapper: BrowserRouter });
}

// ============================================================================
// Exports
// ============================================================================

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override render with custom render
export { customRender as render, renderWithRouter, createTestQueryClient };
