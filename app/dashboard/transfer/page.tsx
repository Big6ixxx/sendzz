"use client";

import { BatchSendDialog } from "@/components/batch-send/BatchSendDialog";
import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
import type { Activity } from "@/components/HistoryModule";
import { ActivityDetailModal } from "@/components/ActivityDetailModal";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { useBalanceVisibility } from "@/components/providers/BalanceVisibilityProvider";
import { TransferModule } from "@/components/TransferModule";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSolanaBridge } from "@/hooks/useSolanaBridge";
import { CHAIN_NAMES } from "@/lib/circle/gateway";
import { getCircleAddress } from "@/lib/web3/circle-client";
import { type ChainBalances } from "@/lib/web3/routing";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { stellarSourceFor } from "@/lib/web3/stellar-bridge";
import { useStellarWallet } from '@/hooks/useStellarWallet';
import { ArrowRight, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// `useSearchParams` needs a Suspense boundary to prerender.
export default function TransfersPage() {
  return (
    <Suspense>
      <TransfersPageContent />
    </Suspense>
  );
}

function TransfersPageContent() {
  // `?to=` pre-fills the recipient — the landing page sends people here with the email they typed.
  const to = useSearchParams().get("to")?.trim() ?? "";
  const prefill = EMAIL_RE.test(to) ? to : undefined;
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { hideBalance } = useBalanceVisibility();
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [smartAddress, setSmartAddress] = useState<string>("");
  const [batchSendDialogOpen, setBatchSendDialogOpen] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState(500);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const { data: stellarWallet } = useStellarWallet();
  const stellarAddress = stellarWallet?.address ?? "";

  // Embedded Solana wallet address (for the portfolio total).
  const solAccount = user?.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      (a as { walletClientType?: string }).walletClientType === "privy" &&
      (a as { chainType?: string }).chainType === "solana",
  );
  const solanaAddress =
    solAccount && "address" in solAccount
      ? (solAccount as { address: string }).address
      : undefined;

  const { data: portfolio } = usePortfolio(smartAddress, solanaAddress, stellarAddress || undefined);


  // EVM per-chain balances + total — what's spendable via routing.
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
  const fundedChains = portfolio?.byChain.filter((c) => c.hasBalance) ?? [];

  // Solana is spendable via auto-bridge to Base.
  const { bridgeToBase } = useSolanaBridge();
  const solanaBalance =
    parseFloat(
      portfolio?.byChain.find((c) => c.chain === "solana")?.balance ?? "0",
    ) || 0;
  const solanaSource =
    bridgeToBase && solanaBalance > 0
      ? { balance: solanaBalance, bridgeToBase }
      : undefined;
  // Solana counts only while something can spend it. Without a signer (no Solana wallet in this
  // session yet) `solanaSource` is undefined, and the balance is shown but not offered — adding
  // it here let MAX and the withdrawal check promise money no route could move.
  const solanaSpendable = solanaSource ? solanaBalance : 0;
  const stellarBalance =
    parseFloat(
      portfolio?.byChain.find((c) => c.chain === "stellar")?.balance ?? "0",
    ) || 0;
  const totalSpendable = (evmSpendable + solanaSpendable + stellarBalance).toFixed(2);

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
      } catch (err) {
        console.error("[Transfer] INIT ACCOUNT ERROR:", err);
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
          setTwoFaThreshold(data.two_fa_threshold || 500);
          setTotpEnabled(data.totp_enabled || false);
          const credentials = data.webauthn_credentials || [];
          setPasskeyEnabled(Array.isArray(credentials) && credentials.length > 0);
        }
      } catch (e) {
        console.error("Failed to load security prefs", e);
      }
    }

    if (ready && authenticated && wallets.length > 0) {
      initAccount();
      fetchSecurityPrefs();
    }
  }, [ready, authenticated, wallets, user?.email?.address]);

  if (!ready || !authenticated || !user) {
    return <PageSkeleton variant="form" />;
  }

  const chainName = (chain: string) =>
    CHAIN_NAMES[chain as keyof typeof CHAIN_NAMES] ??
    (chain === "solana" ? "Solana" : chain === "stellar" ? "Stellar" : chain);

  const sideCards = (
    <>
      <section className="lp-card rounded-[28px] p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Available to send</h2>
          <span className="lp-display text-[22px] tracking-[-0.03em] tabular-nums">
            {hideBalance ? "••••" : `$${totalSpendable}`}
          </span>
        </div>
        {fundedChains.length === 0 ? (
          <p className="mt-3 text-[14px] text-[var(--lp-muted)]">Nothing yet. Add money to get started.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--lp-line)]">
            {fundedChains.map((c) => (
              <li key={c.chain} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex items-center gap-2.5 text-[14px]">
                  <ChainLogo chain={c.chain} size={20} />
                  {chainName(c.chain)}
                </span>
                <span className="text-[14px] font-semibold tabular-nums">
                  {hideBalance ? "••••" : `$${parseFloat(c.balance).toFixed(2)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[13px] leading-[1.5] text-[var(--lp-muted)]">
          We pay from the cheapest network that holds your money, and move it across when needed. Network fees are on us.
        </p>
      </section>

      <section className="rounded-[28px] bg-[var(--lp-sand)] p-5 sm:p-6">
        <span className="grid size-11 place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-cream)]">
          <Users className="size-5" />
        </span>
        <h2 className="lp-display mt-4 text-[24px] leading-none tracking-[-0.03em]">
          Paying <span className="lp-serif">a group?</span>
        </h2>
        <p className="mt-2 text-[14px] leading-[1.5] text-[var(--lp-body)]">
          Send to a whole team at once, by email. One confirmation for everyone.
        </p>
        <button
          type="button"
          onClick={() => setBatchSendDialogOpen(true)}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-5 text-[14px] font-semibold text-[var(--lp-cream)] transition-transform duration-150 hover:-translate-y-px"
        >
          Pay everyone at once <ArrowRight className="size-4" />
        </button>
      </section>
    </>
  );

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 pb-24 md:space-y-8">
      <PageHeader eyebrow="Transfer" title="Send money" italic="to anyone." />

      <TransferModule
        key={prefill}
        initialRecipientEmail={prefill}
        smartAddress={smartAddress}
        embeddedProvider={wallets.find(
          (w) => w.walletClientType === "privy",
        )}
        balance={totalSpendable}
        chainBalances={evmChainBalances}
        solanaSource={solanaSource}
        senderEmail={user?.email?.address || ""}
        extra={sideCards}
      />

      <RecentActivity
        userId={user.id}
        userEmail={user.email?.address || ""}
        onOpen={setSelectedActivity}
      />

      <ActivityDetailModal
        activity={selectedActivity}
        isOpen={!!selectedActivity}
        onClose={() => setSelectedActivity(null)}
      />

      <BatchSendDialog
        open={batchSendDialogOpen}
        onOpenChange={setBatchSendDialogOpen}
        maxAmount={parseFloat(totalSpendable)}
        smartAddress={smartAddress}
        embeddedProvider={wallets.find((w) => w.walletClientType === "privy")}
        senderEmail={user?.email?.address || ""}
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
    </div>
  );
}
