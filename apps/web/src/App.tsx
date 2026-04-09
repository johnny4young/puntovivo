import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { TenantProvider } from '@/features/tenant/TenantProvider';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { CompanyPage } from '@/features/company/CompanyPage';
import { ProvidersPage } from '@/features/providers/ProvidersPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { SequentialsPage } from '@/features/sequentials/SequentialsPage';
import { SitesPage } from '@/features/sites/SitesPage';
import { LocationsPage } from '@/features/locations/LocationsPage';
import { UnitsPage } from '@/features/units/UnitsPage';
import { VatRatesPage } from '@/features/vat-rates/VatRatesPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { PurchasesPage } from '@/features/purchases/PurchasesPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { SalesPage } from '@/features/sales/SalesPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { UsersPage } from '@/features/users/UsersPage';
import {
  adminOnlyRoles,
  dashboardRoles,
  getDefaultRouteForRole,
  managerOrAdminRoles,
  salesRoles,
} from '@/features/auth/roleAccess';
import { useAuth } from '@/features/auth/AuthProvider';

function HomeRedirect() {
  const { user } = useAuth();

  return <Navigate to={getDefaultRouteForRole(user?.role)} replace />;
}

function App() {
  return (
    <AuthProvider>
      <TenantProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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
                <ProtectedRoute allowedRoles={dashboardRoles}>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="company"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <CompanyPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="sites"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <SitesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="sequentials"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <SequentialsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="locations"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <LocationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="providers"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <ProvidersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="categories"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <CategoriesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="units"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <UnitsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="vat-rates"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <VatRatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="products"
              element={
                <ProtectedRoute allowedRoles={managerOrAdminRoles}>
                  <ProductsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="purchases"
              element={
                <ProtectedRoute allowedRoles={managerOrAdminRoles}>
                  <PurchasesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="customers"
              element={
                <ProtectedRoute allowedRoles={managerOrAdminRoles}>
                  <CustomersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="sales"
              element={
                <ProtectedRoute allowedRoles={salesRoles}>
                  <SalesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="inventory"
              element={
                <ProtectedRoute allowedRoles={managerOrAdminRoles}>
                  <InventoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute allowedRoles={adminOnlyRoles}>
                  <UsersPage />
                </ProtectedRoute>
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
