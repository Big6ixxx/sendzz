"use client";

import { BatchSendDialog } from "@/components/batch-send/BatchSendDialog";
import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
import { HistoryModule } from "@/components/HistoryModule";
import { DashboardPageHeader } from "@/components/layout/DashboardPageHeader";
import { TransferModule } from "@/components/TransferModule";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSolanaBridge } from "@/hooks/useSolanaBridge";
import { CHAIN_NAMES } from "@/lib/circle/gateway";
import { getCircleAddress } from "@/lib/web3/circle-client";
import { type ChainBalances } from "@/lib/web3/routing";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ArrowRight, Loader2, ShieldCheck, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function TransfersPage() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const router = useRouter();
  const [smartAddress, setSmartAddress] = useState<string>("");
  const [batchSendDialogOpen, setBatchSendDialogOpen] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState(500);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [stellarAddress, setStellarAddress] = useState<string>("");

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

  // Automatically provision or retrieve the user's Stellar wallet from the DB/API
  useEffect(() => {
    async function initStellar() {
      if (user?.id && user?.email?.address) {
        try {
          const res = await fetch('/api/stellar/provision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ privyUserId: user.id, email: user.email.address }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.address) {
              setStellarAddress(data.address);
            }
          }
        } catch (err) {
          console.error('[Transfer] Failed to load Stellar wallet:', err);
        }
      }
    }
    initStellar();
  }, [user?.id, user?.email?.address]);

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
  const stellarBalance =
    parseFloat(
      portfolio?.byChain.find((c) => c.chain === "stellar")?.balance ?? "0",
    ) || 0;
  const totalSpendable = (evmSpendable + solanaBalance + stellarBalance).toFixed(2);

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
          `/api/user/preferences?email=${encodeURIComponent(user.email.address)}`,
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
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="max-w-5xl mx-auto space-y-8">
        <DashboardPageHeader
          title="Transfer"
          subtitle="Send to an email or wallet — we route from whichever network holds your funds."
        />

        <div className="grid lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7">
            <TransferModule
              smartAddress={smartAddress}
              embeddedProvider={wallets.find(
                (w) => w.walletClientType === "privy",
              )}
              balance={totalSpendable}
              chainBalances={evmChainBalances}
              solanaSource={solanaSource}
              senderEmail={user?.email?.address || ""}
            />
          </div>

          <div className="lg:col-span-5 space-y-6">
            {/* Per-network balance breakdown */}
            <div className="card-glass p-6 space-y-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-brand-secondary/40">
                  Available to send
                </h3>
                <span className="font-display text-lg font-bold text-brand-secondary">
                  ${totalSpendable}
                </span>
              </div>
              {fundedChains.length === 0 ? (
                <p className="text-xs text-brand-secondary/35 py-2">
                  No funds yet — deposit to get started.
                </p>
              ) : (
                <div className="space-y-1">
                  {fundedChains.map((c) => (
                    <div
                      key={c.chain}
                      className="flex items-center justify-between px-2 py-2 rounded-xl hover:bg-white/3 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <ChainLogo chain={c.chain} size={18} />
                        <span className="text-sm font-medium text-brand-secondary/80">
                          {CHAIN_NAMES[c.chain as keyof typeof CHAIN_NAMES] ??
                            (c.chain === "solana" ? "Solana" : c.chain === "stellar" ? "Stellar" : c.chain)}
                        </span>
                      </div>
                      <span className="text-sm font-mono font-bold text-brand-secondary">
                        ${parseFloat(c.balance).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-brand-secondary/30 leading-relaxed pt-1 border-t border-white/5">
                We automatically pay from the cheapest network that holds your
                funds, and bridge across networks when needed.
              </p>
            </div>

            {/* Batch */}
            <div className="card-glass p-6 space-y-5">
              <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                <Users className="w-6 h-6 text-accent" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold tracking-tight text-brand-secondary">
                  Batch Payments
                </h3>
                <p className="text-sm text-brand-secondary/50 leading-relaxed">
                  Pay a team or group — send to many emails at once, routed and
                  consolidated across networks automatically.
                </p>
              </div>
              <button
                onClick={() => setBatchSendDialogOpen(true)}
                className="w-full btn-accent h-12 rounded-2xl flex items-center justify-center gap-3 group text-xs font-bold uppercase tracking-widest"
              >
                Launch Batch Engine
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

            <div className="card-glass p-6 space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-accent">
                <ShieldCheck className="w-4 h-4" />
                Gas-Sponsored
              </div>
              <p className="text-xs text-brand-secondary/40 font-medium leading-relaxed">
                Every transfer is gas-sponsored across all networks — you never
                hold ETH or pay network fees.
              </p>
            </div>
          </div>
        </div>

        {/* Recent transfers inline */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-brand-secondary/40">
              Recent Activity
            </h3>
            <button
              onClick={() => router.push("/dashboard/history")}
              className="text-[10px] font-bold uppercase tracking-widest text-accent/70 hover:text-accent transition-colors"
            >
              View All
            </button>
          </div>
          <div className="card-glass p-1 rounded-3xl overflow-hidden">
            <HistoryModule
              userId={user.id}
              userEmail={user.email?.address || ""}
              limit={5}
              hideHeader
              hideLoadMore
              onTxClick={(a) => router.push(`/dashboard/activity/${a.id}`)}
            />
          </div>
        </div>

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
        />
      </div>
    </TooltipProvider>
  );
}
