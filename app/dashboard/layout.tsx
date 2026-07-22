"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { NotificationCenter } from "@/components/NotificationCenter";
import { usePrivy } from "@privy-io/react-auth";
import { Menu } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { motion } from "framer-motion";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready, authenticated, logout, user } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (ready && !authenticated) {
      router.push("/");
    }
  }, [ready, authenticated, router]);

  useEffect(() => {
    const items = [
      { name: 'Dashboard', href: '/dashboard' },
      { name: 'Transfer', href: '/dashboard/transfer' },
      { name: 'History', href: '/dashboard/history' },
      { name: 'Settings', href: '/dashboard/settings' },
    ];
    const section = items.find(item => item.href === pathname)?.name || 'Dashboard';
    document.title = `${section} | Sendzz`;
  }, [pathname]);

  if (!ready) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center relative overflow-hidden" style={{ background: '#07070a' }}>
        {/* Ambient background blobs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
            style={{
              background: 'radial-gradient(circle, #00e87a 0%, transparent 70%)',
            }}
          />
        </div>

        <div className="relative z-10 flex flex-col items-center gap-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', duration: 0.8 }}
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
              Syncing <span className="text-accent">Sendzz</span>
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

  if (!authenticated) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#07070a" }}>
      {/* Ambient glow — subtle, dashboard version */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] rounded-full opacity-[0.06] blur-[100px]"
          style={{
            background: "radial-gradient(circle, #00e87a, transparent 70%)",
          }}
        />
        <div
          className="absolute bottom-[5%] right-[10%] w-[400px] h-[400px] rounded-full opacity-[0.04] blur-[80px]"
          style={{
            background: "radial-gradient(circle, #3b82f6, transparent 70%)",
          }}
        />
      </div>

      <Sidebar
        userEmail={user?.email?.address || ""}
        pathname={pathname}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onLogout={() => logout()}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Unified Dashboard Header containing Notification Center */}
        <header
          className="flex items-center justify-between lg:justify-end py-4 px-4 md:px-6 lg:px-8 sticky top-0 z-30 shrink-0"
          style={{
            background: "rgba(7, 7, 10, 0.4)",
            backdropFilter: "blur(24px) saturate(180%)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {/* Logo only visible on mobile/tablet */}
          <div className="lg:hidden">
            <Link href="/">
              <Image
                src="/logo.svg"
                alt="Sendzz"
                width={100}
                height={30}
                priority
              />
            </Link>
          </div>
          
          <div className="flex items-center gap-4">
            <NotificationCenter userEmail={user?.email?.address || ""} />
            
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl transition-colors"
              style={{ color: "rgba(248,248,246,0.5)" }}
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
