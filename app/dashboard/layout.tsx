'use client';

import { Sidebar } from '@/components/Sidebar';
import { usePrivy } from '@privy-io/react-auth';
import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { logout, user } = usePrivy();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen" style={{ background: '#07070a' }}>
      {/* Ambient glow — subtle, dashboard version */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] rounded-full opacity-[0.06] blur-[100px]"
          style={{
            background: 'radial-gradient(circle, #00e87a, transparent 70%)',
          }}
        />
        <div
          className="absolute bottom-[5%] right-[10%] w-[400px] h-[400px] rounded-full opacity-[0.04] blur-[80px]"
          style={{
            background: 'radial-gradient(circle, #3b82f6, transparent 70%)',
          }}
        />
      </div>

      <Sidebar
        userEmail={user?.email?.address || ''}
        pathname={pathname}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onLogout={() => logout()}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Header */}
        <header
          className="lg:hidden flex items-center justify-between p-4 sticky top-0 z-30"
          style={{
            background: 'rgba(7, 7, 10, 0.75)',
            backdropFilter: 'blur(24px) saturate(180%)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center font-display font-bold text-sm"
              style={{ background: '#00e87a', color: '#07070a' }}
            >
              S
            </div>
            <span className="font-display font-bold tracking-tight text-sm">
              Sendzz
            </span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-xl transition-colors"
            style={{ color: 'rgba(248,248,246,0.5)' }}
          >
            <Menu className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12">
          {children}
        </div>
      </main>
    </div>
  );
}
