"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Loader2,
  LayoutDashboard,
  ArrowLeftRight,
  Users,
  ShieldAlert,
  LogOut,
  Menu,
  X,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { motion } from "framer-motion";

import { checkIsAdmin } from "@/lib/supabase/actions";

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
    async function verify() {
      if (ready && authenticated && user?.email?.address) {
        try {
          const result = await checkIsAdmin(user.email.address);
          setIsAdmin(result);
        } catch (err) {
          console.error("[Admin Auth Error]", err);
          setIsAdmin(false);
        }
      } else if (ready && !authenticated) {
        router.push("/");
      }
    }
    verify();
  }, [ready, authenticated, user, router]);

  if (!ready || isAdmin === null) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#0a0a0b] gap-4">
        <div className="relative">
          <div className="absolute inset-0 bg-[#00e87a]/20 blur-xl rounded-full animate-pulse" />
          <Loader2 className="animate-spin w-8 h-8 text-[#00e87a] relative z-10" />
        </div>
        <div className="text-white/20 text-[10px] font-mono uppercase tracking-[0.3em] animate-pulse">
          Secure Session Initializing...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#0a0a0b] p-6 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mb-8 border border-red-500/20">
          <Lock className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-4xl font-display font-bold text-white mb-3 tracking-tight">
          Access Restricted
        </h1>
        <p className="text-white/40 max-w-sm mb-10 font-medium leading-relaxed">
          This area is restricted to authorized platform administrators only.
          Your attempt has been logged for security.
        </p>
        <button
          onClick={() => router.push("/dashboard")}
          className="px-8 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold hover:bg-white/10 transition-all active:scale-95"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const navItems = [
    { name: "Overview", href: "/admin", icon: LayoutDashboard },
    { name: "Transactions", href: "/admin/transactions", icon: ArrowLeftRight },
    { name: "Users", href: "/admin/users", icon: Users },
    { name: "System Logs", href: "/admin/logs", icon: ShieldAlert },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex overflow-hidden">
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
          "fixed inset-y-0 left-0 z-40 w-72 bg-[#0a0a0b] border-r border-white/5 transition-all duration-300 transform lg:relative lg:translate-x-0 shadow-[20px_0_50px_rgba(0,0,0,0.5)]",
          !isSidebarOpen && "-translate-x-full",
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
                    "flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group relative overflow-hidden",
                    isActive
                      ? "bg-[#00e87a]/10 text-[#00e87a] shadow-[0_0_20px_rgba(0,232,122,0.05)]"
                      : "text-white/40 hover:text-white hover:bg-white/5",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-active"
                      className="absolute left-0 top-0 bottom-0 w-1 bg-[#00e87a] rounded-r-full"
                    />
                  )}
                  <item.icon
                    className={cn(
                      "w-5 h-5 transition-transform duration-300 group-hover:scale-110",
                      isActive
                        ? "text-[#00e87a]"
                        : "text-white/20 group-hover:text-white/50",
                    )}
                  />
                  <span className="font-bold tracking-tight">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="pt-8 border-t border-white/5 space-y-4">
            <div className="px-5 py-4 rounded-2xl bg-white/[0.03] border border-white/5 group hover:border-[#00e87a]/20 transition-all">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#00e87a] animate-pulse" />
                <p className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">
                  Live Session
                </p>
              </div>
              <p className="text-xs font-bold text-white truncate group-hover:text-[#00e87a] transition-colors">
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
      <main className="flex-1 overflow-y-auto bg-[#0a0a0b] relative">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-500/5 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-[#00e87a]/5 blur-[120px] rounded-full translate-y-1/2 -translate-x-1/2" />

        <div className="p-8 lg:p-12 max-w-7xl mx-auto relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}
