import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { OfflineStatusBanner } from './OfflineStatusBanner';
import { cn } from '@/lib/utils';

export function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onToggleCollapse={() => setSidebarCollapsed(current => !current)}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div
        className={cn(
          'relative min-h-screen transition-[margin] duration-300',
          sidebarCollapsed ? 'lg:ml-[6.5rem]' : 'lg:ml-[18.5rem]'
        )}
      >
        <Header onOpenSidebar={() => setMobileSidebarOpen(true)} />
        <OfflineStatusBanner />

        <main className="px-4 py-4 sm:px-6 sm:py-6 xl:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
