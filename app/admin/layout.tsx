'use client';

import { cn } from '@/lib/utils';
import { checkIsAdmin } from '@/lib/supabase/admin';
import { usePrivy } from '@privy-io/react-auth';
import { motion } from 'framer-motion';
import {
  ArrowLeftRight,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  ShieldAlert,
  User,
  Users,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const navItems = [
  { name: 'Overview', href: '/admin', icon: LayoutDashboard },
  { name: 'Transactions', href: '/admin/transactions', icon: ArrowLeftRight },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'System Logs', href: '/admin/logs', icon: ShieldAlert },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready, authenticated, user, logout } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const section =
      navItems.find((item) => item.href === pathname)?.name || 'Admin';
    document.title = `${section} | Sendzz`;
  }, [pathname]);

  useEffect(() => {
    async function verify() {
      if (ready && authenticated && user?.email?.address) {
        try {
          const result = await checkIsAdmin(user.email.address);
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
  }, [ready, authenticated, user, router]);

  if (!ready || isAdmin === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center overflow-hidden relative" style={{ background: '#07070a' }}>
        <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
            style={{ background: 'radial-gradient(circle, #00e87a 0%, transparent 70%)' }}
          />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="absolute inset-0 rounded-full blur-2xl bg-accent/20 scale-150 animate-pulse" />
            <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center bg-white/5 backdrop-blur-xl p-0 overflow-hidden border border-accent/20">
              <Image src="/logo.svg" alt="Sendzz" width={48} height={48} className="animate-pulse" priority />
              <div className="absolute inset-0 border-2 border-transparent border-t-accent rounded-3xl animate-spin" style={{ animationDuration: '2s' }} />
            </div>
          </motion.div>
          <div className="flex flex-col items-center gap-4">
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="font-display text-2xl font-bold tracking-tight text-white"
            >
              Syncing <span className="text-accent">Admin</span>
            </motion.h2>
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                  className="w-2 h-2 rounded-full bg-accent"
                />
              ))}
            </div>
          </div>
        </div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="fixed bottom-12 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-[0.4em] text-white/20"
        >
          Authorizing Secure Access
        </motion.p>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center relative overflow-hidden" style={{ background: '#07070a' }}>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-red-500/5 blur-[120px] pointer-events-none" />
        <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center bg-red-400/5 backdrop-blur-xl border border-red-400/20 mb-8 shadow-2xl">
          <Lock className="w-10 h-10 text-red-400" />
        </div>
        <h1 className="text-4xl font-display font-black text-white mb-4 tracking-tighter">Access Restricted</h1>
        <p className="text-white/40 max-w-sm mb-10 font-medium leading-relaxed">
          This area is restricted to authorized platform administrators only. Your attempt has been logged for security.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="px-8 py-4 rounded-2xl font-bold transition-all active:scale-95"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: '#f8f8f6' }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#07070a' }}>
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] rounded-full opacity-[0.06] blur-[100px]"
          style={{ background: 'radial-gradient(circle, #00e87a, transparent 70%)' }}
        />
        <div
          className="absolute bottom-[5%] right-[10%] w-[400px] h-[400px] rounded-full opacity-[0.04] blur-[80px]"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent 70%)' }}
        />
      </div>

      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: 'rgba(7,7,10,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{
          background: 'rgba(10, 10, 11, 0.7)',
          backdropFilter: 'blur(32px) saturate(180%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex flex-col h-full p-5 overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center justify-between mb-10 px-2 shrink-0">
            <Link href="/">
              <Image src="/logo.svg" alt="Sendzz" width={100} height={30} priority />
            </Link>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 rounded-lg transition-colors lg:hidden"
              style={{ color: 'rgba(248,248,246,0.4)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsSidebarOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative"
                  style={{
                    color: active ? '#f8f8f6' : 'rgba(248,248,246,0.4)',
                    background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
                    border: active ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                    backdropFilter: active ? 'blur(8px)' : 'none',
                  }}
                >
                  {active && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                      style={{ background: '#00e87a' }}
                    />
                  )}
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User + logout */}
          <div className="mt-auto pt-5 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div
              className="px-3 py-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(0,232,122,0.15)', color: '#00e87a' }}
                >
                  <User className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: 'rgba(248,248,246,0.8)' }}>
                    {user?.email?.address}
                  </p>
                  <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'rgba(248,248,246,0.25)' }}>
                    Admin Account
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => logout()}
              className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all"
              style={{ color: 'rgba(248,248,246,0.35)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#f87171';
                e.currentTarget.style.background = 'rgba(248,113,113,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(248,248,246,0.35)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Header */}
        <header
          className="lg:hidden flex items-center justify-between p-4 sticky top-0 z-30"
          style={{
            background: 'rgba(7,7,10,0.75)',
            backdropFilter: 'blur(24px) saturate(180%)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <Link href="/">
            <Image src="/logo.svg" alt="Sendzz" width={100} height={30} priority />
          </Link>
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
