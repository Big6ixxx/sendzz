'use client';

import { usePrivy } from '@privy-io/react-auth';
import { 
  LayoutDashboard, 
  Send, 
  History, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  CreditCard,
  User
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { logout, user } = usePrivy();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Transfers', href: '/dashboard/transfers', icon: Send },
    { name: 'History', href: '/dashboard/history', icon: History },
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-foreground/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-background border-r border-border transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full p-6">
          <div className="flex items-center gap-3 mb-10 px-2">
            <div className="w-10 h-10 bg-foreground text-background rounded-xl flex items-center justify-center font-black text-xl">S</div>
            <h1 className="text-2xl font-black tracking-tighter uppercase">Sendzz</h1>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setIsSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all group",
                  pathname === item.href 
                    ? "bg-foreground text-background" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            ))}
          </nav>

          <div className="mt-auto pt-6 border-t border-border space-y-4">
            <div className="px-4 py-3 bg-muted/50 rounded-2xl border border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-foreground/10 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{user?.email?.address || 'Anonymous'}</p>
                  <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest">Personal Account</p>
                </div>
              </div>
            </div>
            
            <button
              onClick={() => logout()}
              className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm font-semibold text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-all"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-background">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-foreground text-background rounded-lg flex items-center justify-center font-black">S</div>
            <span className="font-black tracking-tighter uppercase">Sendzz</span>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 hover:bg-muted rounded-lg"
          >
            <Menu className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12">
          {children}
        </div>
      </main>
    </div>
  );
}
