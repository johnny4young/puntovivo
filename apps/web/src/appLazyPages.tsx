// Lazy-loaded page registry for the app router, extracted from App.tsx
// (ENG-178 slice 35). Each entry is its own dynamic import() chunk; the route
// tree in App.tsx renders these by name. Moving the registry here keeps the
// same chunk boundaries (vite emits identical per-route chunks).

import { lazy, type ComponentType } from 'react';

function lazyPage<T extends ComponentType>(loader: () => Promise<{ default: T }>) {
  return lazy(loader);
}

export const LoginPage = lazyPage(async () => ({
  default: (await import('@/features/auth/LoginPage')).LoginPage,
}));
export const DashboardPage = lazyPage(async () => ({
  default: (await import('@/features/dashboard/DashboardPage')).DashboardPage,
}));
export const CopilotPage = lazyPage(async () => ({
  default: (await import('@/features/copilot/CopilotPage')).CopilotPage,
}));
export const AiConfigPage = lazyPage(async () => ({
  default: (await import('@/features/ai-config/AiConfigPage')).default,
}));
export const CompanyPage = lazyPage(async () => ({
  default: (await import('@/features/company/CompanyPage')).CompanyPage,
}));
export const CustomerCatalogsPage = lazyPage(async () => ({
  default: (await import('@/features/customer-catalogs/CustomerCatalogsPage')).CustomerCatalogsPage,
}));
export const GeographyPage = lazyPage(async () => ({
  default: (await import('@/features/geography/GeographyPage')).GeographyPage,
}));
export const ProvidersPage = lazyPage(async () => ({
  default: (await import('@/features/providers/ProvidersPage')).ProvidersPage,
}));
export const CategoriesPage = lazyPage(async () => ({
  default: (await import('@/features/categories/CategoriesPage')).CategoriesPage,
}));
export const SequentialsPage = lazyPage(async () => ({
  default: (await import('@/features/sequentials/SequentialsPage')).SequentialsPage,
}));
export const SitesPage = lazyPage(async () => ({
  default: (await import('@/features/sites/SitesPage')).SitesPage,
}));
export const LocationsPage = lazyPage(async () => ({
  default: (await import('@/features/locations/LocationsPage')).LocationsPage,
}));
export const UnitsPage = lazyPage(async () => ({
  default: (await import('@/features/units/UnitsPage')).UnitsPage,
}));
export const VatRatesPage = lazyPage(async () => ({
  default: (await import('@/features/vat-rates/VatRatesPage')).VatRatesPage,
}));
export const ProductsPage = lazyPage(async () => ({
  default: (await import('@/features/products/ProductsPage')).ProductsPage,
}));
export const OrdersPage = lazyPage(async () => ({
  default: (await import('@/features/orders/OrdersPage')).OrdersPage,
}));
export const PurchasesPage = lazyPage(async () => ({
  default: (await import('@/features/purchases/PurchasesPage')).PurchasesPage,
}));
export const QuotationsPage = lazyPage(async () => ({
  default: (await import('@/features/quotations/QuotationsPage')).QuotationsPage,
}));
export const DeliveryPage = lazyPage(async () => ({
  default: (await import('@/features/delivery/DeliveryPage')).DeliveryPage,
}));
export const ReceiptTemplatesPage = lazyPage(async () => ({
  default: (await import('@/features/receipt-templates/ReceiptTemplatesPage')).ReceiptTemplatesPage,
}));
export const AuditLogsPage = lazyPage(async () => ({
  default: (await import('@/features/audit-logs/AuditLogsPage')).AuditLogsPage,
}));
export const FiscalDocumentListPage = lazyPage(async () => ({
  default: (await import('@/features/fiscal/FiscalDocumentListPage')).FiscalDocumentListPage,
}));
export const FiscalReportsPage = lazyPage(async () => ({
  default: (await import('@/features/fiscal/FiscalReportsPage')).FiscalReportsPage,
}));
export const ProfitMarginReportPage = lazyPage(async () => ({
  default: (await import('@/features/reports/ProfitMarginReportPage')).ProfitMarginReportPage,
}));
export const CustomersPage = lazyPage(async () => ({
  default: (await import('@/features/customers/CustomersPage')).CustomersPage,
}));
export const SalesPage = lazyPage(async () => ({
  default: (await import('@/features/sales/SalesPage')).SalesPage,
}));
export const InventoryPage = lazyPage(async () => ({
  default: (await import('@/features/inventory/InventoryPage')).InventoryPage,
}));
export const UsersPage = lazyPage(async () => ({
  default: (await import('@/features/users/UsersPage')).UsersPage,
}));
export const PeripheralsPage = lazyPage(async () => ({
  default: (await import('@/features/peripherals/PeripheralsPage')).PeripheralsPage,
}));
export const OperationsPage = lazyPage(async () => ({
  default: (await import('@/features/operations/OperationsPage')).OperationsPage,
}));
// ENG-069 — surface shells + placeholder pages. Each surface mounts
// as a top-level route OUTSIDE of <MainLayout> so it owns its full
// viewport (KDS fullscreen, customer-display second monitor, mobile
// waiter phone-width). Real workflows plug into the existing shells
// in ENG-039 without forking the App component.
export const TouchShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/TouchShell')).TouchShell,
}));
// ENG-039a — real restaurant voice-ordering surface replaces the
// `TouchHomePlaceholder` for `/touch`. The placeholder file stays
// in the repo as the reference for the KDS / customer-display
// surfaces that still ship the "Coming with ENG-039" chrome.
export const TouchHome = lazyPage(async () => ({
  default: (await import('@/features/restaurants/TouchHome')).default,
}));
// ENG-087 — voice ordering was the previous default of `/touch`.
// After ENG-087 ships the V1 POS grid as the `/touch` home, the
// voice ordering surface moves to `/touch/voice` so the ENG-039a
// flow stays reachable for operators who rely on it. The wrapper
// pins `variant="touch"` so the route component matches the
// existing tablet two-column shape used before this slice.
export const TouchVoiceRoute = lazyPage(async () => {
  const mod = await import('@/features/restaurants/VoiceOrderingScreen');
  return {
    default: () => <mod.VoiceOrderingScreen variant="touch" />,
  };
});
// ENG-039b — admin page for the restaurant table catalog.
export const RestaurantTablesPage = lazyPage(async () => ({
  default: (await import('@/features/restaurants/RestaurantTablesPage')).RestaurantTablesPage,
}));
export const KdsShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/KdsShell')).KdsShell,
}));
export const KdsHomePlaceholder = lazyPage(async () => ({
  default: (await import('@/features/surfaces/KdsHomePlaceholder')).KdsHomePlaceholder,
}));
export const CustomerDisplayShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/CustomerDisplayShell')).CustomerDisplayShell,
}));
export const CustomerDisplayHomePlaceholder = lazyPage(async () => ({
  default: (await import('@/features/surfaces/CustomerDisplayHomePlaceholder'))
    .CustomerDisplayHomePlaceholder,
}));
export const MobileWaiterShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/MobileWaiterShell')).MobileWaiterShell,
}));
// ENG-039a — real restaurant voice-ordering surface replaces the
// `MobileWaiterHomePlaceholder` for `/m`.
export const MobileWaiterHome = lazyPage(async () => ({
  default: (await import('@/features/restaurants/MobileWaiterHome')).default,
}));
// ENG-131c — workspace landing pages for /catalog, /procurement,
// and /finance. Each lazy wrapper pins the workspaceId so the same
// generic component renders the right workspace catalogue.
export const CatalogLandingRoute = lazyPage(async () => {
  const mod = await import('@/features/workspaces/WorkspaceLandingPage');
  return { default: () => <mod.WorkspaceLandingPage workspaceId="catalog" /> };
});
export const ProcurementLandingRoute = lazyPage(async () => {
  const mod = await import('@/features/workspaces/WorkspaceLandingPage');
  return { default: () => <mod.WorkspaceLandingPage workspaceId="procurement" /> };
});
export const FinanceLandingRoute = lazyPage(async () => {
  const mod = await import('@/features/workspaces/WorkspaceLandingPage');
  return { default: () => <mod.WorkspaceLandingPage workspaceId="finance" /> };
});
