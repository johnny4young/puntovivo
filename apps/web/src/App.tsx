import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { CommandPaletteProvider } from '@/components/feedback/CommandPaletteProvider';
import { LocaleSync } from '@/features/locale/LocaleProvider';
import { TenantProvider } from '@/features/tenant/TenantProvider';
import { ModulesSync } from '@/features/modules';
import { SurfaceShellRoute } from '@/features/surfaces/SurfaceShellRoute';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  adminOnlyRoles,
  dashboardRoles,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';
import { HomeRedirect, LoginRoute, ShellRoute } from './appRouteHelpers';
import {
  AiConfigPage,
  AuditLogsPage,
  CatalogLandingRoute,
  CategoriesPage,
  CompanyPage,
  CopilotPage,
  CustomerCatalogsPage,
  CustomerDisplayHomePlaceholder,
  CustomerDisplayShell,
  CustomersPage,
  DashboardPage,
  DeliveryPage,
  FinanceLandingRoute,
  FiscalDocumentListPage,
  FiscalReportsPage,
  ProfitMarginReportPage,
  GeographyPage,
  InventoryPage,
  KdsHomePlaceholder,
  KdsShell,
  LocationsPage,
  LoginPage,
  MobileWaiterHome,
  MobileWaiterShell,
  OperationsPage,
  OrdersPage,
  PeripheralsPage,
  ProcurementLandingRoute,
  ProductsPage,
  ProvidersPage,
  PurchasesPage,
  QuotationsPage,
  ReceiptTemplatesPage,
  RestaurantTablesPage,
  SalesPage,
  SequentialsPage,
  SitesPage,
  TouchHome,
  TouchShell,
  TouchVoiceRoute,
  UnitsPage,
  UsersPage,
  VatRatesPage,
} from './appLazyPages';

function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        {/* ENG-171 — Modules + Locale state moved from context providers to
            Zustand stores. These null-rendering sync hosts run the backing
            tRPC queries (and the locale side-effects) inside Auth+Tenant
            without re-creating a context value every render. */}
        <ModulesSync />
        <LocaleSync />
        <CommandPaletteProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <LoginRoute>
                  <LoginPage />
                </LoginRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomeRedirect />} />
              <Route
                path="dashboard"
                element={
                  <ShellRoute allowedRoles={dashboardRoles}>
                    <DashboardPage />
                  </ShellRoute>
                }
              />
              <Route
                path="co-pilot"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles} allowedModule="copilot">
                    <CopilotPage />
                  </ShellRoute>
                }
              />
              <Route
                path="settings/ai"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <AiConfigPage />
                  </ShellRoute>
                }
              />
              <Route
                path="company"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <CompanyPage />
                  </ShellRoute>
                }
              />
              <Route
                path="sites"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <SitesPage />
                  </ShellRoute>
                }
              />
              <Route
                path="sequentials"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <SequentialsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="locations"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <LocationsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="restaurants/tables"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <RestaurantTablesPage />
                  </ShellRoute>
                }
              />
              <Route
                path="customer-catalogs"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <CustomerCatalogsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="geography"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <GeographyPage />
                  </ShellRoute>
                }
              />
              <Route
                path="providers"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <ProvidersPage />
                  </ShellRoute>
                }
              />
              <Route
                path="categories"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <CategoriesPage />
                  </ShellRoute>
                }
              />
              <Route
                path="units"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <UnitsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="vat-rates"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <VatRatesPage />
                  </ShellRoute>
                }
              />
              <Route
                path="products"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles}>
                    <ProductsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="orders"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles}>
                    <OrdersPage />
                  </ShellRoute>
                }
              />
              <Route
                path="purchases"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles}>
                    <PurchasesPage />
                  </ShellRoute>
                }
              />
              <Route
                path="quotations"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles} allowedModule="quotations">
                    <QuotationsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="delivery"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles} allowedModule="delivery">
                    <DeliveryPage />
                  </ShellRoute>
                }
              />
              <Route
                path="customers"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles}>
                    <CustomersPage />
                  </ShellRoute>
                }
              />
              <Route
                path="sales"
                element={
                  <ShellRoute allowedRoles={salesRoles}>
                    <SalesPage />
                  </ShellRoute>
                }
              />
              <Route
                path="inventory"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles}>
                    <InventoryPage />
                  </ShellRoute>
                }
              />
              <Route
                path="users"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <UsersPage />
                  </ShellRoute>
                }
              />
              <Route
                path="receipt-templates"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <ReceiptTemplatesPage />
                  </ShellRoute>
                }
              />
              <Route
                path="peripherals"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <PeripheralsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="operations"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles} allowedModule="operations-center">
                    <OperationsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="audit-logs"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <AuditLogsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="fiscal-documents"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <FiscalDocumentListPage />
                  </ShellRoute>
                }
              />
              <Route
                path="fiscal-reports"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <FiscalReportsPage />
                  </ShellRoute>
                }
              />
              <Route
                path="profitability"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <ProfitMarginReportPage />
                  </ShellRoute>
                }
              />
              {/* ENG-131c — workspace landing routes. Each `/catalog`,
                `/procurement`, `/finance` URL now resolves to a
                grid-of-cards landing page that mirrors the workspace
                items the operator can see, filtered by role and
                active modules. Deep links to leaf routes (/products,
                /audit-logs, etc.) continue to resolve as before. */}
              <Route
                path="catalog"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles}>
                    <CatalogLandingRoute />
                  </ShellRoute>
                }
              />
              <Route
                path="procurement"
                element={
                  <ShellRoute allowedRoles={managerOrAdminRoles}>
                    <ProcurementLandingRoute />
                  </ShellRoute>
                }
              />
              <Route
                path="finance"
                element={
                  <ShellRoute allowedRoles={adminOnlyRoles}>
                    <FinanceLandingRoute />
                  </ShellRoute>
                }
              />
            </Route>
            {/* ENG-069 — surface shells. Each owns its full viewport
              outside MainLayout so the surface chrome (KDS fullscreen
              dark backdrop, customer-display gradient, mobile-waiter
              phone-width container, POS Touch wider buttons) is not
              boxed inside the desktop sidebar + Header. ENG-183 — role +
              module gating lives in SurfaceShellRoute (route level), BEFORE
              the lazy shell import, so a disabled module never loads its
              chunk or flashes its chrome; the shells are pure chrome. */}
            <Route
              path="touch"
              element={
                <SurfaceShellRoute allowedRoles={salesRoles} allowedModule="pos-touch">
                  <TouchShell />
                </SurfaceShellRoute>
              }
            >
              <Route index element={<TouchHome />} />
              <Route path="voice" element={<TouchVoiceRoute />} />
            </Route>
            <Route
              path="kds"
              element={
                <SurfaceShellRoute allowedRoles={salesRoles} allowedModule="kds">
                  <KdsShell />
                </SurfaceShellRoute>
              }
            >
              <Route index element={<KdsHomePlaceholder />} />
            </Route>
            <Route
              path="customer-display"
              element={
                <SurfaceShellRoute allowedRoles={salesRoles} allowedModule="customer-display">
                  <CustomerDisplayShell />
                </SurfaceShellRoute>
              }
            >
              <Route index element={<CustomerDisplayHomePlaceholder />} />
            </Route>
            <Route
              path="m"
              element={
                <SurfaceShellRoute allowedRoles={salesRoles} allowedModule="mobile-waiter">
                  <MobileWaiterShell />
                </SurfaceShellRoute>
              }
            >
              <Route index element={<MobileWaiterHome />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CommandPaletteProvider>
      </TenantProvider>
    </AuthProvider>
  );
}

export default App;
