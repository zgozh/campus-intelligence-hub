import { RequireAuth } from '../../src/components/RequireAuth';
import { SearchParamsProvider } from '../../src/router/react-router-dom';
import AdminLayout from '../../src/components/AdminLayout';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <SearchParamsProvider>
        <AdminLayout>{children}</AdminLayout>
      </SearchParamsProvider>
    </RequireAuth>
  );
}
