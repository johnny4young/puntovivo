import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FullscreenLoadingState,
  PageLoadingState,
} from '@/components/feedback/LoadingState';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LocaleProvider } from '@/features/locale/LocaleProvider';
import { TenantProvider } from '@/features/tenant/TenantProvider';
import { ModulesProvider, RequireModule } from '@/features/modules';
import { SurfaceShellRoute } from '@/features/surfaces/SurfaceShellRoute';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { MainLayout } from '@/components/layout/MainLayout';
import {
  adminOnlyRoles,
  dashboardRoles,
  getDefaultRouteForRole,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';
import { useAuth } from '@/features/auth/AuthProvider';
import type { UserRole } from '@/types';
import type { ClientModuleId } from '@/features/modules';

function lazyPage<T extends ComponentType>(loader: () => Promise<{ default: T }>) {
  return lazy(loader);
}

const LoginPage = lazyPage(async () => ({
  default: (await import('@/features/auth/LoginPage')).LoginPage,
}));
const DashboardPage = lazyPage(async () => ({
  default: (await import('@/features/dashboard/DashboardPage')).DashboardPage,
}));
const CopilotPage = lazyPage(async () => ({
  default: (await import('@/features/copilot/CopilotPage')).CopilotPage,
}));
const CompanyPage = lazyPage(async () => ({
  default: (await import('@/features/company/CompanyPage')).CompanyPage,
}));
const CustomerCatalogsPage = lazyPage(async () => ({
  default: (await import('@/features/customer-catalogs/CustomerCatalogsPage')).CustomerCatalogsPage,
}));
const GeographyPage = lazyPage(async () => ({
  default: (await import('@/features/geography/GeographyPage')).GeographyPage,
}));
const ProvidersPage = lazyPage(async () => ({
  default: (await import('@/features/providers/ProvidersPage')).ProvidersPage,
}));
const CategoriesPage = lazyPage(async () => ({
  default: (await import('@/features/categories/CategoriesPage')).CategoriesPage,
}));
const SequentialsPage = lazyPage(async () => ({
  default: (await import('@/features/sequentials/SequentialsPage')).SequentialsPage,
}));
const SitesPage = lazyPage(async () => ({
  default: (await import('@/features/sites/SitesPage')).SitesPage,
}));
const LocationsPage = lazyPage(async () => ({
  default: (await import('@/features/locations/LocationsPage')).LocationsPage,
}));
const UnitsPage = lazyPage(async () => ({
  default: (await import('@/features/units/UnitsPage')).UnitsPage,
}));
const VatRatesPage = lazyPage(async () => ({
  default: (await import('@/features/vat-rates/VatRatesPage')).VatRatesPage,
}));
const ProductsPage = lazyPage(async () => ({
  default: (await import('@/features/products/ProductsPage')).ProductsPage,
}));
const OrdersPage = lazyPage(async () => ({
  default: (await import('@/features/orders/OrdersPage')).OrdersPage,
}));
const PurchasesPage = lazyPage(async () => ({
  default: (await import('@/features/purchases/PurchasesPage')).PurchasesPage,
}));
const QuotationsPage = lazyPage(async () => ({
  default: (await import('@/features/quotations/QuotationsPage')).QuotationsPage,
}));
const ReceiptTemplatesPage = lazyPage(async () => ({
  default: (await import('@/features/receipt-templates/ReceiptTemplatesPage'))
    .ReceiptTemplatesPage,
}));
const AuditLogsPage = lazyPage(async () => ({
  default: (await import('@/features/audit-logs/AuditLogsPage')).AuditLogsPage,
}));
const FiscalDocumentListPage = lazyPage(async () => ({
  default: (await import('@/features/fiscal/FiscalDocumentListPage'))
    .FiscalDocumentListPage,
}));
const FiscalReportsPage = lazyPage(async () => ({
  default: (await import('@/features/fiscal/FiscalReportsPage')).FiscalReportsPage,
}));
const CustomersPage = lazyPage(async () => ({
  default: (await import('@/features/customers/CustomersPage')).CustomersPage,
}));
const SalesPage = lazyPage(async () => ({
  default: (await import('@/features/sales/SalesPage')).SalesPage,
}));
const InventoryPage = lazyPage(async () => ({
  default: (await import('@/features/inventory/InventoryPage')).InventoryPage,
}));
const UsersPage = lazyPage(async () => ({
  default: (await import('@/features/users/UsersPage')).UsersPage,
}));
const PeripheralsPage = lazyPage(async () => ({
  default: (await import('@/features/peripherals/PeripheralsPage')).PeripheralsPage,
}));
const OperationsPage = lazyPage(async () => ({
  default: (await import('@/features/operations/OperationsPage')).OperationsPage,
}));
// ENG-069 — surface shells + placeholder pages. Each surface mounts
// as a top-level route OUTSIDE of <MainLayout> so it owns its full
// viewport (KDS fullscreen, customer-display second monitor, mobile
// waiter phone-width). Real workflows plug into the existing shells
// in ENG-039 without forking the App component.
const TouchShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/TouchShell')).TouchShell,
}));
// ENG-039a — real restaurant voice-ordering surface replaces the
// `TouchHomePlaceholder` for `/touch`. The placeholder file stays
// in the repo as the reference for the KDS / customer-display
// surfaces that still ship the "Coming with ENG-039" chrome.
const TouchHome = lazyPage(async () => ({
  default: (await import('@/features/restaurants/TouchHome')).default,
}));
// ENG-039b — admin page for the restaurant table catalog.
const RestaurantTablesPage = lazyPage(async () => ({
  default: (await import('@/features/restaurants/RestaurantTablesPage')).RestaurantTablesPage,
}));
const KdsShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/KdsShell')).KdsShell,
}));
const KdsHomePlaceholder = lazyPage(async () => ({
  default: (await import('@/features/surfaces/KdsHomePlaceholder')).KdsHomePlaceholder,
}));
const CustomerDisplayShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/CustomerDisplayShell')).CustomerDisplayShell,
}));
const CustomerDisplayHomePlaceholder = lazyPage(async () => ({
  default: (await import('@/features/surfaces/CustomerDisplayHomePlaceholder')).CustomerDisplayHomePlaceholder,
}));
const MobileWaiterShell = lazyPage(async () => ({
  default: (await import('@/features/surfaces/MobileWaiterShell')).MobileWaiterShell,
}));
// ENG-039a — real restaurant voice-ordering surface replaces the
// `MobileWaiterHomePlaceholder` for `/m`.
const MobileWaiterHome = lazyPage(async () => ({
  default: (await import('@/features/restaurants/MobileWaiterHome')).default,
}));

function HomeRedirect() {
  const { user } = useAuth();

  return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
}

function LoginRoute({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth');

  return (
    <Suspense
      fallback={
        <FullscreenLoadingState
          title={t('login.loadingTitle')}
          description={t('login.loadingDescription')}
        />
      }
    >
      {children}
    </Suspense>
  );
}

function ShellRoute({
  allowedRoles,
  allowedModule,
  children,
}: {
  allowedRoles?: readonly UserRole[];
  /**
   * ENG-068 — when set, the route renders only when the module is
   * active for the active tenant. When the module is off, the route
   * redirects to `/dashboard` (the closest universally-allowed
   * destination) so a stale URL or a manager who flipped the module
   * mid-session is never trapped on a blank route.
   */
  allowedModule?: ClientModuleId;
  children: ReactNode;
}) {
  const { t } = useTranslation('common');

  const inner = (
    <Suspense
      fallback={
        <PageLoadingState
          title={t('loading.pageTitle')}
          description={t('loading.pageDescription')}
        />
      }
    >
      {children}
    </Suspense>
  );

  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
      {allowedModule ? (
        <RequireModule id={allowedModule} fallback={<Navigate to="/dashboard" replace />}>
          {inner}
        </RequireModule>
      ) : (
        inner
      )}
    </ProtectedRoute>
  );
}

function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        <ModulesProvider>
        <LocaleProvider>
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
          </Route>
          {/* ENG-069 — surface shells. Each owns its full viewport
              outside MainLayout so the surface chrome (KDS fullscreen
              dark backdrop, customer-display gradient, mobile-waiter
              phone-width container, POS Touch wider buttons) is not
              boxed inside the desktop sidebar + Header. Each shell
              composes ProtectedRoute + RequireModule + outlet Suspense
              internally; the route-level wrapper catches the lazy shell
              import before that internal boundary exists. */}
          <Route
            path="touch"
            element={
              <SurfaceShellRoute>
                <TouchShell />
              </SurfaceShellRoute>
            }
          >
            <Route index element={<TouchHome />} />
          </Route>
          <Route
            path="kds"
            element={
              <SurfaceShellRoute>
                <KdsShell />
              </SurfaceShellRoute>
            }
          >
            <Route index element={<KdsHomePlaceholder />} />
          </Route>
          <Route
            path="customer-display"
            element={
              <SurfaceShellRoute>
                <CustomerDisplayShell />
              </SurfaceShellRoute>
            }
          >
            <Route index element={<CustomerDisplayHomePlaceholder />} />
          </Route>
          <Route
            path="m"
            element={
              <SurfaceShellRoute>
                <MobileWaiterShell />
              </SurfaceShellRoute>
            }
          >
            <Route index element={<MobileWaiterHome />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </LocaleProvider>
        </ModulesProvider>
      </TenantProvider>
    </AuthProvider>
  );
}

export default App;
