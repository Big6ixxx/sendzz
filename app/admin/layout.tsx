'use client';

import { cn } from '@/lib/utils';
import { checkIsAdmin } from '@/lib/supabase/admin';
import { usePrivy } from '@privy-io/react-auth';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  ShieldAlert,
  Store,
  Undo2,
  User,
  Users,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { brandFontVars } from '@/components/landing/fonts';
import '@/components/landing/landing.css';

const navItems = [
  { name: 'Overview', href: '/admin', icon: LayoutDashboard },
  { name: 'Transactions', href: '/admin/transactions', icon: ArrowLeftRight },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Refunds Owed', href: '/admin/refunds', icon: Undo2 },
  { name: 'Merchants', href: '/admin/merchants', icon: Store },
  { name: 'System Logs', href: '/admin/logs', icon: ShieldAlert },
];

/** A section is current on its own page and, past the overview, on the pages beneath it. */
const isCurrent = (pathname: string, href: string) =>
  href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Desktop collapse, mirroring components/layout/Sidebar.tsx. The key is admin-scoped so
  // collapsing here doesn't also collapse the user dashboard.
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('admin-sidebar-collapsed') === 'true';
    }
    return false;
  });

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('admin-sidebar-collapsed', String(next));
      return next;
    });
  };

  useEffect(() => {
    const section = navItems.find((item) => isCurrent(pathname, item.href))?.name || 'Admin';
    document.title = `${section} | Sendzz`;
  }, [pathname]);

  useEffect(() => {
    async function verify() {
      if (ready && authenticated && user?.email?.address) {
        try {
          const result = await checkIsAdmin((await getAccessToken()) ?? undefined);
          setIsAdmin(result);
        } catch (err) {
          console.error('[Admin Auth Error]', err);
          setIsAdmin(false);
        }
      } else if (ready && !authenticated) {
        router.push('/');
      }
    }
    verify();
  }, [ready, authenticated, user, router, getAccessToken]);

  if (!ready || isAdmin === null) {
    return (
      <div className={`lp-root ${brandFontVars} min-h-screen flex flex-col items-center justify-center gap-10`}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative grid size-24 place-items-center rounded-[28px] bg-white shadow-[0_0_0_1px_rgb(17_26_19/0.06)]"
        >
          <Image src="/landing/logo.svg" alt="Sendzz" width={56} height={20} priority />
          <div
            className="absolute inset-0 rounded-[28px] border-2 border-transparent border-t-[var(--lp-green)] animate-spin"
            style={{ animationDuration: '2s' }}
          />
        </motion.div>
        <div className="flex flex-col items-center gap-3">
          <p className="lp-mono text-[12px] uppercase text-[var(--lp-muted)]">Admin</p>
          <h2 className="lp-display text-[28px] font-bold tracking-[-0.03em]">
            Checking your <span className="lp-serif font-normal tracking-[-0.01em]">access.</span>
          </h2>
          <div className="flex items-center gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                className="size-2 rounded-full bg-[var(--lp-ink)]"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className={`lp-root ${brandFontVars} min-h-screen flex flex-col items-center justify-center p-8 text-center`}>
        <div className="mb-8 grid size-20 place-items-center rounded-[24px] bg-[#a1462c]/10">
          <Lock className="size-9 text-[#a1462c]" />
        </div>
        <p className="lp-mono text-[12px] uppercase text-[var(--lp-muted)]">Admin</p>
        <h1 className="lp-display mt-2 mb-4 text-[clamp(36px,5vw,56px)] leading-[0.95] tracking-[-0.045em]">
          Access <span className="lp-serif tracking-[-0.02em]">restricted.</span>
        </h1>
        <p className="mb-10 max-w-sm text-[16px] leading-[1.5] text-[var(--lp-body)]">
          This area is restricted to authorized platform administrators only. Your attempt has been logged for security.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="inline-flex h-12 items-center rounded-full bg-[var(--lp-ink)] px-6 text-[15px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className={`lp-root ${brandFontVars} flex h-dvh overflow-hidden`}>
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'rgba(17,26,19,0.35)', backdropFilter: 'blur(4px)' }}
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar: the user dashboard's, in the cream style */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 transform transition-all duration-300 ease-in-out lg:relative lg:translate-x-0',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          isCollapsed ? 'w-64 lg:w-20' : 'w-64',
        )}
        style={{ background: '#fbf9f4', borderRight: '1px solid #e3dcce' }}
      >
        <div className={cn('flex h-full flex-col overflow-y-auto transition-all duration-300', isCollapsed ? 'p-3 lg:px-4' : 'p-5')}>
          {/* Logo */}
          <div className={cn('mb-8 flex shrink-0 items-center justify-between', isCollapsed ? 'lg:flex-col lg:items-center lg:gap-4' : 'px-2')}>
            <Link href="/admin" className="flex shrink-0 items-center gap-2.5">
              {isCollapsed ? (
                <Image src="/landing/mark.svg" alt="Sendzz" width={24} height={30} priority />
              ) : (
                <>
                  <Image src="/landing/logo.svg" alt="Sendzz" width={100} height={30} priority />
                  <span className="lp-mono rounded-full bg-[var(--lp-ink)] px-2 py-0.5 text-[10px] uppercase text-[var(--lp-green)]">
                    Admin
                  </span>
                </>
              )}
            </Link>

            <button
              onClick={toggleCollapse}
              className="hidden rounded-lg p-1.5 text-[var(--lp-muted)] outline-none transition-colors hover:bg-[var(--lp-cream)] hover:text-[var(--lp-ink)] lg:flex"
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? <ChevronRight className="w-4.5 h-4.5" /> : <ChevronLeft className="w-4.5 h-4.5" />}
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close menu"
              className="rounded-lg p-1.5 text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-cream)] lg:hidden"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-1" aria-label="Admin">
            {!isCollapsed && <p className="lp-mono px-3 pb-2 text-[11px] uppercase text-[var(--lp-muted)]">Manage</p>}
            {navItems.map((item) => {
              const active = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsSidebarOpen(false)}
                  title={isCollapsed ? item.name : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-all',
                    isCollapsed && 'lg:justify-center lg:px-0',
                    active
                      ? 'bg-[var(--lp-ink)] text-[var(--lp-cream)]'
                      : 'text-[var(--lp-body)] hover:bg-[#f0ebe0] hover:text-[var(--lp-ink)]',
                  )}
                >
                  <item.icon className={cn('w-4.5 h-4.5 shrink-0', active && 'text-[var(--lp-green)]')} />
                  <span className={cn('transition-all duration-300', isCollapsed ? 'lg:hidden' : 'inline')}>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* User + logout */}
          <div className="mt-auto space-y-2 pt-5" style={{ borderTop: '1px solid #e3dcce' }}>
            <div className={cn('px-3 py-3 transition-all', isCollapsed ? 'lg:px-0 lg:py-1' : 'rounded-[18px] bg-[var(--lp-cream)]')}>
              <div className={cn('flex items-center gap-2.5', isCollapsed && 'lg:justify-center')}>
                <div
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--lp-green)] text-[var(--lp-ink)]"
                  title={isCollapsed ? user?.email?.address : undefined}
                >
                  <User className="w-3.5 h-3.5" />
                </div>
                <div className={cn('min-w-0 flex-1 transition-all duration-300', isCollapsed ? 'lg:hidden' : 'block')}>
                  <p className="truncate text-xs font-semibold text-[var(--lp-ink)]">{user?.email?.address}</p>
                  <p className="lp-mono text-[10px] uppercase text-[var(--lp-muted)]">Admin account</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => logout()}
              title={isCollapsed ? 'Sign Out' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium text-[var(--lp-muted)] transition-all hover:bg-[#a1462c]/[0.08] hover:text-[#a1462c]',
                isCollapsed && 'lg:justify-center lg:px-0',
              )}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className={cn('transition-all duration-300', isCollapsed ? 'lg:hidden' : 'inline')}>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 lg:hidden"
          style={{ background: 'rgba(246,242,233,0.9)', backdropFilter: 'blur(6px)', borderBottom: '1px solid #e3dcce' }}
        >
          <Link href="/admin" className="flex items-center gap-2.5">
            <Image src="/landing/logo.svg" alt="Sendzz" width={100} height={30} priority />
            <span className="lp-mono rounded-full bg-[var(--lp-ink)] px-2 py-0.5 text-[10px] uppercase text-[var(--lp-green)]">Admin</span>
          </Link>
          <button
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open menu"
            className="grid size-11 place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-cream)]"
          >
            <Menu className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1360px] px-4 pb-24 pt-6 md:px-7 md:pt-10">{children}</div>
        </div>
      </main>
    </div>
  );
}
