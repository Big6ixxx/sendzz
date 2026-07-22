"use client";

import { cn } from "@/lib/utils";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  History,
  LayoutDashboard,
  LogOut,
  Repeat,
  Send,
  Settings,
  Star,
  User,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";

const NAV_ITEMS = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Transfer", href: "/dashboard/transfer", icon: Send },
  { name: "Smart Bridge", href: "/dashboard/bridge", icon: Repeat },
  { name: "History", href: "/dashboard/history", icon: History },
  { name: "Notifications", href: "/dashboard/notifications", icon: Bell },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

interface SidebarProps {
  userEmail: string;
  pathname: string;
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}

export function Sidebar({
  userEmail,
  pathname,
  isOpen,
  onClose,
  onLogout,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Initialize from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("sidebar-collapsed");
      if (stored === "true") {
        setIsCollapsed(true);
      }
    }
  }, []);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{
            background: "rgba(7,7,10,0.7)",
            backdropFilter: "blur(4px)",
          }}
          onClick={onClose}
        />
      )}

      {/* Sidebar Panel */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 transform transition-all duration-300 ease-in-out lg:relative lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          isCollapsed ? "w-64 lg:w-20" : "w-64"
        )}
        style={{
          background: "rgba(10, 10, 11, 0.7)",
          backdropFilter: "blur(32px) saturate(180%)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className={cn("flex flex-col h-full overflow-y-auto transition-all duration-300", isCollapsed ? "p-3 lg:px-4" : "p-5")}>
          {/* Logo */}
          <div className={cn("flex items-center justify-between mb-10 shrink-0", isCollapsed ? "lg:flex-col lg:gap-4 lg:items-center" : "px-2")}>
            <Link href="/" className="block shrink-0">
              {isCollapsed ? (
                <div className="w-8 h-8 relative flex items-center justify-center">
                  <Image
                    src="/Sendz-512.png"
                    alt="Sendzz"
                    width={32}
                    height={32}
                    priority
                    className="object-contain"
                  />
                </div>
              ) : (
                <div
                  className="transition-all duration-300 overflow-hidden"
                  style={{
                    width: "100px",
                    height: "30px",
                  }}
                >
                  <Image
                    src="/logo.svg"
                    alt="Sendzz"
                    width={100}
                    height={30}
                    priority
                    className="max-w-none"
                  />
                </div>
              )}
            </Link>

            {/* Desktop Collapse Toggle */}
            <button
              onClick={toggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg transition-colors text-brand-secondary/40 hover:text-brand-secondary/80 hover:bg-white/5 outline-none"
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? (
                <ChevronRight className="w-4.5 h-4.5" />
              ) : (
                <ChevronLeft className="w-4.5 h-4.5" />
              )}
            </button>

            {/* Mobile close button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors lg:hidden"
              style={{ color: "rgba(248,248,246,0.4)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(255,255,255,0.05)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={onClose}
                  title={isCollapsed ? item.name : undefined}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative",
                    isCollapsed && "lg:justify-center lg:px-0"
                  )}
                  style={{
                    color: active ? "#f8f8f6" : "rgba(248,248,246,0.4)",
                    background: active
                      ? "rgba(255,255,255,0.07)"
                      : "transparent",
                    border: active
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "1px solid transparent",
                    backdropFilter: active ? "blur(8px)" : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.color = "rgba(248,248,246,0.8)";
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.04)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.color = "rgba(248,248,246,0.4)";
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  {active && !isCollapsed && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                      style={{ background: "#00e87a" }}
                    />
                  )}
                  <item.icon className="w-4.5 h-4.5 shrink-0" />
                  <span className={cn("transition-all duration-300", isCollapsed ? "lg:hidden" : "inline")}>
                    {item.name}
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* User + Sign out */}
          <div
            className="mt-auto pt-5 space-y-2"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div
              className={cn(
                "px-3 py-3 rounded-xl transition-all",
                isCollapsed ? "lg:bg-transparent lg:border-transparent lg:px-0 lg:py-1" : "rgba(255,255,255,0.04)"
              )}
              style={
                isCollapsed
                  ? undefined
                  : {
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }
              }
            >
              <div className={cn("flex items-center gap-2.5", isCollapsed && "lg:justify-center")}>
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: "rgba(0, 232, 122, 0.15)",
                    color: "#00e87a",
                  }}
                  title={isCollapsed ? (userEmail || "Anonymous") : undefined}
                >
                  <User className="w-3.5 h-3.5" />
                </div>
                <div className={cn("flex-1 min-w-0 transition-all duration-300", isCollapsed ? "lg:hidden" : "block")}>
                  <p
                    className="text-xs font-semibold truncate"
                    style={{ color: "rgba(248,248,246,0.8)" }}
                  >
                    {userEmail || "Anonymous"}
                  </p>
                  <p
                    className="text-[9px] uppercase tracking-widest font-bold"
                    style={{ color: "rgba(248,248,246,0.25)" }}
                  >
                    Personal Account
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={onLogout}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all",
                isCollapsed && "lg:justify-center lg:px-0"
              )}
              title={isCollapsed ? "Sign Out" : undefined}
              style={{ color: "rgba(248,248,246,0.35)", background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#f87171";
                e.currentTarget.style.background = "rgba(248,113,113,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(248,248,246,0.35)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className={cn("transition-all duration-300", isCollapsed ? "lg:hidden" : "inline")}>
                Sign Out
              </span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
