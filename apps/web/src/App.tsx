import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { TenantProvider } from '@/features/tenant/TenantProvider';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { CompanyPage } from '@/features/company/CompanyPage';
import { ProvidersPage } from '@/features/providers/ProvidersPage';
import { SequentialsPage } from '@/features/sequentials/SequentialsPage';
import { SitesPage } from '@/features/sites/SitesPage';
import { UnitsPage } from '@/features/units/UnitsPage';
import { VatRatesPage } from '@/features/vat-rates/VatRatesPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { CustomersPage } from '@/features/customers/CustomersPage';
import { SalesPage } from '@/features/sales/SalesPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { UsersPage } from '@/features/users/UsersPage';

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
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="company" element={<CompanyPage />} />
            <Route path="sites" element={<SitesPage />} />
            <Route path="sequentials" element={<SequentialsPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="units" element={<UnitsPage />} />
            <Route path="vat-rates" element={<VatRatesPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TenantProvider>
    </AuthProvider>
  );
}

export default App;
