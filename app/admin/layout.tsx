'use client';

import { checkIsAdmin } from '@/lib/supabase/admin';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeftRight, LayoutDashboard, Lock, ShieldAlert, Store, Undo2, Users } from 'lucide-react';
import { AppShell, isNavCurrent, type AppNavItem } from '@/components/layout/AppShell';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import '@/components/landing/landing.css';
import { BrandLoading } from '@/components/landing/StatusScreen';
import { FlowLabel } from '@/components/flow/ui';

const navItems: AppNavItem[] = [
  { name: 'Overview', href: '/admin', icon: LayoutDashboard },
  { name: 'Transactions', href: '/admin/transactions', icon: ArrowLeftRight },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Refunds Owed', href: '/admin/refunds', icon: Undo2 },
  { name: 'Merchants', href: '/admin/merchants', icon: Store },
  { name: 'System Logs', href: '/admin/logs', icon: ShieldAlert },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const section = navItems.find((item) => isNavCurrent(pathname, item.href, '/admin'))?.name || 'Admin';
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
    return <BrandLoading label="Checking your access" />;
  }

  if (isAdmin === false) {
    return (
      <div className="lp-root min-h-screen flex flex-col items-center justify-center p-8 text-center">
        <div className="mb-8 grid size-20 place-items-center rounded-[24px] bg-[var(--lp-danger-soft)]">
          <Lock className="size-9 text-[var(--lp-danger)]" />
        </div>
        <FlowLabel>Admin</FlowLabel>
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
    <AppShell
      nav={navItems}
      pathname={pathname}
      home="/admin"
      badge="Admin"
      storageKey="admin-sidebar-collapsed"
      navLabel="Admin"
      sectionLabel="Manage"
      accountLabel="Admin account"
      userEmail={user?.email?.address}
      onLogout={() => logout()}
      contentClassName="mx-auto w-full max-w-[1360px] px-4 pb-24 pt-6 md:px-7 md:pt-10"
    >
      {children}
    </AppShell>
  );
}
