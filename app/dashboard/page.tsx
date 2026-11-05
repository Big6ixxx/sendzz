"use client";

import { BatchSendDialog } from "@/components/batch-send/BatchSendDialog";
import { DepositWithdrawDialog } from "@/components/deposit-withdraw/DepositWithdrawDialog";
import { type Activity } from "@/components/HistoryModule";
import { ActivityDetailModal } from "@/components/ActivityDetailModal";
import { PendingIncomingPanel } from "@/components/PendingIncomingPanel";
import { registerMyAddresses } from "@/lib/supabase/users";
import { clearReferral, readReferral } from "@/lib/referrals/client";
import { getCircleAddress } from "@/lib/web3/circle-client";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSolanaBridge } from "@/hooks/useSolanaBridge";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { stellarSourceFor } from "@/lib/web3/stellar-bridge";
import { useStellarWallet } from "@/hooks/useStellarWallet";
import { PendingBridgeClaims } from "@/components/bridge/PendingBridgeClaims";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { LandingSupport } from "@/components/landing/LandingSupport";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type ChainBalances } from "@/lib/web3/routing";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";

export default function Dashboard() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();

  // Embedded Privy Solana wallet — look up via linkedAccounts (walletClientType is not exposed on ConnectedStandardSolanaWallet)
  const privySolAccount = user?.linkedAccounts.find(
    (a) => a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "solana"
  );
  const embeddedSolWallet =
    privySolAccount && "address" in privySolAccount
      ? { address: (privySolAccount as { address: string }).address }
      : null;

  const [smartAddress, setSmartAddress] = useState<string>("");
  // Lookup only (Stellar is opt-in) — see hooks/useStellarWallet.
  const { data: stellarWallet } = useStellarWallet();
  const stellarAddress = stellarWallet?.address ?? "";
  const stellarWalletId = stellarWallet?.walletId ?? "";
  const stellarTrustlineReady = !!stellarWallet?.trustlineReady;
  const [rampModalOpen, setRampModalOpen] = useState(false);
  const [batchSendDialogOpen, setBatchSendDialogOpen] = useState(false);
  const [rampType, setRampType] = useState<"deposit" | "withdraw">("deposit");
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [twoFaThreshold, setTwoFaThreshold] = useState(500);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);

  // Unified portfolio across every supported chain. Drives both the headline balance
  // and the per-chain spendable amounts routed to transfers / batch / withdraw.
  const {
    data: portfolio,
    isLoading: isPortfolioLoading,
    isFetching: isPortfolioFetching,
    refetch: refetchPortfolio,
  } = usePortfolio(smartAddress, embeddedSolWallet?.address, stellarAddress || undefined);

  const portfolioTotal = portfolio?.total ?? "0.00";
  const fundedChains = portfolio?.byChain.filter((c) => c.hasBalance) ?? [];

  // EVM per-chain balances + their sum — the amount currently spendable via routing
  // (transfers + batch). Excludes Solana, which routing doesn't source from yet.
  const evmChainBalances: ChainBalances = useMemo(() => {
    const map: ChainBalances = {};
    for (const c of portfolio?.byChain ?? []) {
      if (c.chain === "solana" || c.chain === "stellar") continue;
      map[c.chain] = parseFloat(c.balance) || 0;
    }
    return map;
  }, [portfolio]);
  const evmSpendable = Object.values(evmChainBalances).reduce(
    (s, n) => s + (n ?? 0),
    0,
  );

  // Solana is spendable too — auto-bridged to Base on demand by the routing/consolidation,
  // and can also settle an off-ramp directly on Solana (settleOffRamp).
  const { bridgeToBase, settleOffRamp } = useSolanaBridge();
  const solanaBalance =
    parseFloat(
      portfolio?.byChain.find((c) => c.chain === "solana")?.balance ?? "0",
    ) || 0;
  const solanaSource =
    bridgeToBase && solanaBalance > 0
      ? { balance: solanaBalance, bridgeToBase, settleOffRamp: settleOffRamp ?? undefined }
      : undefined;

  // Solana counts only while something can spend it. Without a signer (no Solana wallet in this
  // session yet) `solanaSource` is undefined, and the balance is shown but not offered — adding
  // it here let MAX and the withdrawal check promise money no route could move.
  const solanaSpendable = solanaSource ? solanaBalance : 0;
  const stellarBalance =
    parseFloat(
      portfolio?.byChain.find((c) => c.chain === "stellar")?.balance ?? "0",
    ) || 0;

  /**
   * The spendable total, rounded DOWN.
   *
   * `toFixed` rounds to nearest, so a real balance of 1.476738 became "1.48" — a figure the
   * wallet cannot actually cover. This value is what the withdrawal screen validates against
   * and what MAX fills in, so rounding up hands the user a couple of thousandths that do not
   * exist and the transfer fails later against the true balance. Down is the only safe
   * direction for a number that says "this much is available".
   */
  const totalSpendable = (
    Math.floor((evmSpendable + solanaSpendable + stellarBalance) * 100) / 100
  ).toFixed(2);

  useEffect(() => {
    if (ready && !authenticated) router.push("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    async function initAccount() {
      try {
        const embeddedWallet = wallets.find(
          (w) => w.walletClientType === "privy",
        );
        if (!embeddedWallet) return;
        const provider = await embeddedWallet.getEthereumProvider();
        const address = await getCircleAddress(provider);
        setSmartAddress(address);
        if (user?.email?.address) {
          // The referral code this browser picked up from a `?ref=` link, handed over at the
          // first moment there is an account to attribute it to. Cleared either way: if it
          // was not honoured now it never will be, and retrying the same decision on every
          // future sign-in achieves nothing.
          const referralCode = readReferral();
          // No email argument: the server takes it from the session. Passing one used to be
          // the whole vulnerability — see the header of lib/supabase/users.ts.
          registerMyAddresses({
            address,
            solanaAddress: embeddedSolWallet?.address,
            referralCode,
          })
            .then(() => {
              if (referralCode) clearReferral();
            })
            .catch(console.error);
        }
      } catch (err) {
        console.error("[Dashboard] INIT ACCOUNT FATAL ERROR:", err);
      }
    }

    async function fetchSecurityPrefs() {
      if (!user?.email?.address) return;
      try {
        const res = await fetch(
          "/api/user/preferences",
        );
        if (res.ok) {
          const data = await res.json();
          // Set 2FA preferences
          setTwoFaThreshold(data.two_fa_threshold || 500);
          setTotpEnabled(data.totp_enabled || false);
          const credentials = data.webauthn_credentials || [];
          setPasskeyEnabled(
            Array.isArray(credentials) && credentials.length > 0,
          );
        }
      } catch (e) {
        console.error("Failed to load security prefs", e);
      }
    }

    if (ready && authenticated && wallets.length > 0) {
      initAccount();
      fetchSecurityPrefs();
    }
  }, [ready, authenticated, wallets, user, embeddedSolWallet?.address]);

  if (!ready || !authenticated || !user) {
    return <PageSkeleton variant="overview" />;
  }

  const openRamp = (type: "deposit" | "withdraw") => {
    setRampType(type);
    setRampModalOpen(true);
  };

  const email = user.email?.address || "";

  return (
    <>
      <DashboardOverview
        email={email}
        userId={user.id}
        total={portfolioTotal}
        loading={isPortfolioLoading}
        refreshing={isPortfolioFetching}
        canRefresh={!!smartAddress}
        onRefresh={() => refetchPortfolio()}
        chains={fundedChains}
        onDeposit={() => openRamp("deposit")}
        onWithdraw={() => openRamp("withdraw")}
        onBatch={() => setBatchSendDialogOpen(true)}
        onSendTo={(to) => router.push(`/dashboard/transfer?to=${encodeURIComponent(to)}`)}
        onOpenActivity={setSelectedActivity}
        // Burns still awaiting a claim, surfaced here too: the dashboard is where a user looks
        // when funds appear to be missing.
        pending={
          <PendingBridgeClaims
            userEmail={email}
            solanaAddress={embeddedSolWallet?.address}
            stellarWallet={
              stellarWalletId && stellarAddress ? { walletId: stellarWalletId, address: stellarAddress } : null
            }
          />
        }
        incoming={<PendingIncomingPanel userId={user.id} userEmail={email} />}
      />

      <ActivityDetailModal
        activity={selectedActivity}
        isOpen={!!selectedActivity}
        onClose={() => setSelectedActivity(null)}
      />

      <DepositWithdrawDialog
        isOpen={rampModalOpen}
        onClose={() => setRampModalOpen(false)}
        type={rampType}
        userId={user?.id || ""}
        userAddress={smartAddress}
        solanaAddress={embeddedSolWallet?.address}
        stellarAddress={stellarAddress || undefined}
        stellarWalletId={stellarWalletId || undefined}
        stellarTrustlineReady={stellarTrustlineReady}
        balance={totalSpendable}
        chainBalances={evmChainBalances}
        solanaSource={solanaSource}
        stellarBalance={stellarBalance}
        userEmail={email}
        embeddedProvider={wallets.find((w) => w.walletClientType === "privy")}
      />

      <BatchSendDialog
        open={batchSendDialogOpen}
        onOpenChange={setBatchSendDialogOpen}
        maxAmount={parseFloat(totalSpendable)}
        smartAddress={smartAddress}
        embeddedProvider={wallets.find((w) => w.walletClientType === "privy")}
        senderEmail={email}
        twoFaThreshold={twoFaThreshold}
        totpEnabled={totpEnabled}
        passkeyEnabled={passkeyEnabled}
        chainBalances={evmChainBalances}
        solanaSource={solanaSource}
        stellarSource={stellarSourceFor(
          stellarWallet,
          stellarBalance,
          wallets.find((w) => w.walletClientType === "privy"),
        )}
      />

      <LandingSupport />
    </>
  );
}

