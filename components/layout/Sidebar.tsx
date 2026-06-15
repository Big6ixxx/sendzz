"use client";

import { cn } from "@/lib/utils";
import {
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

const NAV_ITEMS = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Transfer", href: "/dashboard/transfer", icon: Send },
  { name: "Smart Bridge", href: "/dashboard/bridge", icon: Repeat },
  { name: "History", href: "/dashboard/history", icon: History },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
  { name: "Stellar ✦", href: "/dashboard/stellar", icon: Star },
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
          "fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{
          background: "rgba(10, 10, 11, 0.7)",
          backdropFilter: "blur(32px) saturate(180%)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="flex flex-col h-full p-5 overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center justify-between mb-10 px-2 shrink-0">
            <Link href="/">
              <Image
                src="/logo.svg"
                alt="Sendzz"
                width={100}
                height={30}
                priority
              />
            </Link>
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
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative"
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
                  {active && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
                      style={{ background: "#00e87a" }}
                    />
                  )}
                  <item.icon className="w-4 h-4" />
                  {item.name}
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
              className="px-3 py-3 rounded-xl"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: "rgba(0, 232, 122, 0.15)",
                    color: "#00e87a",
                  }}
                >
                  <User className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
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
              className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium transition-all"
              style={{ color: "rgba(248,248,246,0.35)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#f87171";
                e.currentTarget.style.background = "rgba(248, 113, 113, 0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(248,248,246,0.35)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
