import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FullscreenLoadingState,
  PageLoadingState,
} from '@/components/feedback/LoadingState';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { TenantProvider } from '@/features/tenant/TenantProvider';
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

function lazyPage<T extends ComponentType>(loader: () => Promise<{ default: T }>) {
  return lazy(loader);
}

const LoginPage = lazyPage(async () => ({
  default: (await import('@/features/auth/LoginPage')).LoginPage,
}));
const DashboardPage = lazyPage(async () => ({
  default: (await import('@/features/dashboard/DashboardPage')).DashboardPage,
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
const AuditLogsPage = lazyPage(async () => ({
  default: (await import('@/features/audit-logs/AuditLogsPage')).AuditLogsPage,
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
  children,
}: {
  allowedRoles?: readonly UserRole[];
  children: ReactNode;
}) {
  const { t } = useTranslation('common');

  return (
    <ProtectedRoute allowedRoles={allowedRoles}>
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
    </ProtectedRoute>
  );
}

function App() {
  return (
    <AuthProvider>
      <TenantProvider>
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
                <ShellRoute allowedRoles={managerOrAdminRoles}>
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
              path="audit-logs"
              element={
                <ShellRoute allowedRoles={adminOnlyRoles}>
                  <AuditLogsPage />
                </ShellRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TenantProvider>
    </AuthProvider>
  );
}

export default App;
