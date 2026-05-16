'use client';

import { cn } from '@/lib/utils';
import { usePrivy } from '@privy-io/react-auth';
import { motion } from 'framer-motion';
import {
  ArrowLeftRight,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { checkIsAdmin } from '@/lib/supabase/admin';

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
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
      <div className="min-h-screen bg-brand-primary flex flex-col items-center justify-center overflow-hidden relative">
        <div
          className="fixed inset-0 pointer-events-none overflow-hidden"
          aria-hidden
        >
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
            style={{
              background:
                'radial-gradient(circle, #00e87a 0%, transparent 70%)',
            }}
          />
        </div>

        <div className="relative z-10 flex flex-col items-center gap-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.8,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="relative"
          >
            <div className="absolute inset-0 rounded-full blur-2xl bg-accent/20 scale-150 animate-pulse" />
            <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center bg-white/5 backdrop-blur-xl p-0 overflow-hidden border border-accent/20">
              <Image
                src="/logo.svg"
                alt="Sendzz"
                width={48}
                height={48}
                className="animate-pulse"
                priority
              />
              <div
                className="absolute inset-0 border-2 border-transparent border-t-accent rounded-3xl animate-spin"
                style={{ animationDuration: '2s' }}
              />
            </div>
          </motion.div>

          <div className="flex flex-col items-center gap-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="font-display text-2xl font-bold tracking-tight text-white">
                Syncing <span className="text-accent">Admin</span>
              </h2>
            </motion.div>

            <div className="flex items-center gap-2">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.5,
                    delay: i * 0.2,
                  }}
                  className="w-2 h-2 rounded-full bg-accent"
                />
              ))}
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="fixed bottom-12 left-1/2 -translate-x-1/2"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/20">
            Authorizing Secure Access
          </p>
        </motion.div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-brand-primary flex flex-col items-center justify-center p-8 text-center relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-red-500/5 blur-[120px] pointer-events-none" />
        <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center bg-red-400/5 backdrop-blur-xl border border-red-400/20 mb-8 shadow-2xl">
          <Lock className="w-10 h-10 text-red-400" />
        </div>
        <h1 className="text-4xl font-display font-black text-white mb-4 tracking-tighter">
          Access Restricted
        </h1>
        <p className="text-white/40 max-w-sm mb-10 font-medium leading-relaxed">
          This area is restricted to authorized platform administrators only.
          Your attempt has been logged for security.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="px-8 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-all active:scale-95"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-primary flex overflow-x-hidden">
      {/* Mobile Sidebar Toggle */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="lg:hidden fixed top-4 left-4 z-50 p-3 rounded-xl bg-white/5 border border-white/10 text-white shadow-2xl backdrop-blur-xl"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-72 bg-brand-primary border-r border-white/5 transition-all duration-300 transform lg:relative lg:translate-x-0 shadow-[20px_0_50px_rgba(0,0,0,0.5)]',
          !isSidebarOpen && '-translate-x-full',
        )}
      >
        <div className="h-full flex flex-col p-8">
          <div className="flex items-center justify-between mb-12">
            <Link href="/" className="flex items-center gap-3">
              <Image
                src="/logo.svg"
                alt="Sendzz"
                width={80}
                height={24}
                priority
              />
            </Link>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden text-white/30 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group relative overflow-hidden',
                    isActive
                      ? 'bg-accent/10 text-accent shadow-[0_0_20px_rgba(0,232,122,0.05)]'
                      : 'text-white/40 hover:text-white hover:bg-white/5',
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-active"
                      className="absolute left-0 top-0 bottom-0 w-1 bg-accent rounded-r-full"
                    />
                  )}
                  <item.icon
                    className={cn(
                      'w-5 h-5 transition-transform duration-300 group-hover:scale-110',
                      isActive
                        ? 'text-accent'
                        : 'text-white/20 group-hover:text-white/50',
                    )}
                  />
                  <span className="font-bold tracking-tight">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="pt-8 border-t border-white/5 space-y-4">
            <div className="px-5 py-4 rounded-2xl bg-white/3 border border-white/5 group hover:border-accent/20 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">
                  Live Session
                </p>
              </div>
              <p className="text-xs font-bold text-white truncate group-hover:text-accent transition-colors">
                {user?.email?.address}
              </p>
            </div>
            <button
              onClick={() => logout()}
              className="flex items-center gap-4 px-5 py-4 w-full rounded-2xl text-red-400/60 hover:text-red-400 hover:bg-red-400/5 transition-all group active:scale-95"
            >
              <LogOut className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              <span className="font-bold tracking-tight">System Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 max-w-full overflow-y-auto overflow-x-hidden bg-brand-primary relative">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-accent/5 blur-[120px] rounded-full translate-y-1/2 -translate-x-1/2" />

        <div className="p-8 lg:p-12 max-w-7xl mx-auto relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
