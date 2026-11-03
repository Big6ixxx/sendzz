"use client";

import { AppShell, isNavCurrent, type AppNavItem } from "@/components/layout/AppShell";
import { referralsEnabled } from "@/lib/features";
import { Bell, Gift, History, LayoutDashboard, Repeat, Send, Settings } from "lucide-react";
import { NotificationCenter } from "@/components/NotificationCenter";
import { KycBanner } from "@/components/kyc/KycBanner";
import { PinAuthorizationProvider } from "@/components/security/PinAuthorizationProvider";
import { PinRequiredGate, usePinStatus } from "@/components/security/PinRequiredGate";
import { usePrivy } from "@privy-io/react-auth";
import { useEnsureSolanaWallet } from "@/hooks/useEnsureSolanaWallet";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

import { DotField } from "@/components/landing/DotField";
import { BrandLoading } from "@/components/landing/StatusScreen";
import "@/components/landing/landing.css";


const DASHBOARD_NAV: AppNavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Transfer", href: "/dashboard/transfer", icon: Send },
  { name: "Bridge", href: "/dashboard/bridge", icon: Repeat },
  { name: "History", href: "/dashboard/history", icon: History },
  { name: "Refer & Earn", href: "/dashboard/referrals", icon: Gift, soon: !referralsEnabled() },
  { name: "Notifications", href: "/dashboard/notifications", icon: Bell },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ready, authenticated, logout, user } = usePrivy();
  const pathname = usePathname();
  const router = useRouter();

  // Asked for once, here, rather than per screen: the PIN gates every outgoing path, so the
  // dashboard as a whole is what requires one. `hasPin` stays null until the answer is known,
  // and the gate only opens on a definite "no" — a failed check must not throw a blocking,
  // undismissable dialog at somebody who already has a PIN.
  const { hasPin, setHasPin } = usePinStatus(ready && authenticated);

  // Users who signed in before Solana wallets were created at login never got one, which left
  // any Solana USDC they hold with no signer. Created here, once, for every dashboard screen.
  useEnsureSolanaWallet();

  useEffect(() => {
    if (ready && !authenticated) {
      router.push("/");
    }
  }, [ready, authenticated, router]);

  useEffect(() => {
    // The same match the sidebar highlights, so a sub-page (Settings › Devices) is titled by its section.
    const section = DASHBOARD_NAV.find((item) => isNavCurrent(pathname, item.href, "/dashboard"))?.name ?? "Dashboard";
    document.title = `${section} | Sendzz`;
  }, [pathname]);

  if (!ready) {
    return <BrandLoading label="Opening your account" background={<DotField />} />;
  }

  if (!authenticated) {
    return null;
  }

  const email = user?.email?.address || "";

  return (
    <PinAuthorizationProvider>
      <PinRequiredGate open={hasPin === false} onComplete={() => setHasPin(true)} />
      <AppShell
        nav={DASHBOARD_NAV}
        pathname={pathname}
        home="/dashboard"
        storageKey="sidebar-collapsed"
        navLabel="Dashboard"
        accountLabel="Personal account"
        userEmail={email}
        onLogout={() => logout()}
        besideLogo={<NotificationCenter userEmail={email} />}
        headerExtra={<NotificationCenter userEmail={email} />}
        background={<DotField />}
        banner={<KycBanner userEmail={email} />}
      >
        {children}
      </AppShell>
    </PinAuthorizationProvider>
  );
}
