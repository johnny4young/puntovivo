import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { GlobalStatusStrip } from './GlobalStatusStrip';
import { WhatsNewOverlay } from '@/features/whats-new/WhatsNewOverlay';
import { FirstSaleGuide } from '@/features/onboarding/FirstSaleGuide';
import { cn } from '@/lib/utils';

export function MainLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [firstSaleGuideRequest, setFirstSaleGuideRequest] = useState(0);

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
          'operator-workspace relative min-h-screen min-w-0 transition-[margin] duration-300',
          sidebarCollapsed ? 'xl:ml-[6.5rem]' : 'xl:ml-[18.5rem]'
        )}
      >
        <Header
          onOpenSidebar={() => setMobileSidebarOpen(true)}
          onOpenFirstSaleGuide={() => setFirstSaleGuideRequest(request => request + 1)}
        />
        <GlobalStatusStrip />
        <FirstSaleGuide openRequest={firstSaleGuideRequest} />

        <main className="operator-canvas min-w-0 px-4 py-4 sm:px-6 sm:py-6 xl:px-8">
          <Outlet />
        </main>
      </div>
      {/* per-release announcement overlay. Surfaces once
        the user has logged in and the whatsNew.listUnseen query
        returns rows; persists dismissals via markSeen so the same
        entry does not reappear. */}
      <WhatsNewOverlay />
    </div>
  );
}
