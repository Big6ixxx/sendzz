"use client";

/**
 * ChainBridgeModule — move USDC between the user's own networks.
 *
 * Unlike SmartBridgeModule (which only consolidates idle funds onto Base), this lets
 * the user pick BOTH the source and destination EVM chain and bridge between them via
 * Circle CCTP V2. The mint recipient is the user's own smart account, which shares one
 * address across every EVM chain. Gasless on both legs (burn + mint sponsored by the
 * Circle paymaster).
 *
 * Flow: burn on source → poll Circle Iris for the attestation → mint on destination
 * (use Circle's relayed mint if present, otherwise submit receiveMessage ourselves).
 */

import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
import { usePortfolio } from "@/hooks/usePortfolio";
import {
  CHAIN_EXPLORERS,
  CHAIN_NAMES,
  type SupportedChain,
} from "@/lib/circle/gateway";
import { EVM_CHAINS } from "@/lib/web3/routing";
import { executeSmartBridge, executeReceiveMessage } from "@/lib/web3/bridge-actions";
import {
  recordBridgeTransaction,
  updateBridgeStatus,
} from "@/lib/supabase/transactions";
import { cn } from "@/lib/utils";
import { useWallets } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ChainBridgeModuleProps {
  smartAddress: string;
  userEmail: string;
  solanaAddress?: string;
}

type Phase = "form" | "submitting" | "monitoring" | "complete";

interface Monitor {
  burnTxHash: string;
  sourceChain: SupportedChain;
  destChain: SupportedChain;
}

export function ChainBridgeModule({
  smartAddress,
  userEmail,
  solanaAddress,
}: ChainBridgeModuleProps) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");

  const { data: portfolio, refetch } = usePortfolio(smartAddress, solanaAddress);

  const balanceOf = (chain: SupportedChain) =>
    parseFloat(
      portfolio?.byChain.find((c) => c.chain === chain)?.balance ?? "0",
    ) || 0;

  const [source, setSource] = useState<SupportedChain | null>(null);
  const [dest, setDest] = useState<SupportedChain | null>(null);
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const mintingRef = useRef(false);

  const sourceBalance = source ? balanceOf(source) : 0;
  const amountNum = parseFloat(amount) || 0;
  const canBridge =
    !!source &&
    !!dest &&
    source !== dest &&
    amountNum > 0 &&
    amountNum <= sourceBalance &&
    !!embeddedWallet;

  // ─── Attestation monitor → mint on destination ──────────────────────────────
  useEffect(() => {
    if (!monitor || phase !== "monitoring") return;
    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 180) {
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch(
          `/api/bridge/status?txHash=${monitor.burnTxHash}&sourceChain=${monitor.sourceChain}`,
        );
        const data = await res.json();
        if (data.status !== "complete" || cancelled || mintingRef.current) return;

        mintingRef.current = true;
        clearInterval(interval);

        let mintHash: string | undefined = data.mintTxHash;
        // Circle auto-relays the mint only on some routes; otherwise submit it ourselves.
        if (!mintHash && data.attestation && data.messageBytes && embeddedWallet) {
          mintHash = await executeReceiveMessage(
            embeddedWallet,
            data.messageBytes,
            data.attestation,
            monitor.destChain,
          );
        }

        await updateBridgeStatus(monitor.burnTxHash, "complete", mintHash).catch(
          console.error,
        );
        if (cancelled) return;
        setMintTxHash(mintHash ?? null);
        setPhase("complete");
        queryClient.invalidateQueries({ queryKey: ["portfolio"] });
        queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
        queryClient.invalidateQueries({ queryKey: ["history"] });
        toast.success(`Bridge complete! USDC is now on ${CHAIN_NAMES[monitor.destChain]}.`);
      } catch (err) {
        console.error("[ChainBridge] monitor error:", err);
        mintingRef.current = false;
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [monitor, phase, embeddedWallet, queryClient]);

  const handleBridge = async () => {
    if (!canBridge || !source || !dest || !embeddedWallet) return;
    setPhase("submitting");
    mintingRef.current = false;
    setMintTxHash(null);
    try {
      const { txHashPromise } = await executeSmartBridge(
        embeddedWallet,
        source,
        amount,
        smartAddress,
        dest,
      );
      const burnTxHash = await txHashPromise;

      await recordBridgeTransaction({
        userEmail,
        sourceChain: source,
        destChain: dest,
        amountUsdc: amountNum,
        burnTxHash,
      }).catch(console.error);

      setMonitor({ burnTxHash, sourceChain: source, destChain: dest });
      setPhase("monitoring");
      refetch();
    } catch (err) {
      console.error("[ChainBridge] bridge failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancelled|rejected|denied/i.test(msg)) {
        toast.error(msg.length <= 120 ? msg : "Bridge failed. Please try again.");
      }
      setPhase("form");
    }
  };

  const resetForm = () => {
    setPhase("form");
    setMonitor(null);
    setMintTxHash(null);
    setAmount("");
    setSource(null);
    setDest(null);
    mintingRef.current = false;
    refetch();
  };

  // ─── In-flight / complete states ─────────────────────────────────────────────
  if (phase === "monitoring" || phase === "submitting" || phase === "complete") {
    const isDone = phase === "complete";
    return (
      <div className="card-glass p-12 flex flex-col items-center justify-center text-center space-y-6">
        <div
          className={cn(
            "w-20 h-20 rounded-3xl flex items-center justify-center border transition-all duration-700",
            isDone ? "bg-accent/10 border-accent/40" : "bg-white/5 border-white/10",
          )}
        >
          {isDone ? (
            <CheckCircle2 className="w-10 h-10 text-accent" />
          ) : (
            <Loader2 className="w-10 h-10 text-accent animate-spin" />
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-display font-bold text-white tracking-tight">
            {isDone
              ? "Bridge Complete"
              : phase === "submitting"
                ? "Submitting Transfer"
                : "Bridging Funds"}
          </h3>
          <p className="text-sm text-white/40 max-w-xs mx-auto">
            {isDone && monitor
              ? `Your USDC has arrived on ${CHAIN_NAMES[monitor.destChain]}.`
              : monitor
                ? `Waiting for Circle attestation, then minting on ${CHAIN_NAMES[monitor.destChain]}. This can take a few minutes.`
                : "Requesting signature and burning USDC on the source chain…"}
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-xs">
          {monitor && (
            <a
              href={`${CHAIN_EXPLORERS[monitor.sourceChain]}/${monitor.burnTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View burn transaction
            </a>
          )}
          {isDone && mintTxHash && monitor && (
            <a
              href={`${CHAIN_EXPLORERS[monitor.destChain]}/${mintTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View mint transaction
            </a>
          )}
          {isDone && (
            <button
              onClick={resetForm}
              className="btn-accent h-11 rounded-xl text-[10px] font-bold uppercase tracking-widest"
            >
              Bridge Again
            </button>
          )}
        </div>
        {!isDone && monitor && (
          <p className="text-[10px] text-white/15">
            You can safely close this — the mint completes automatically.
          </p>
        )}
      </div>
    );
  }

  // ─── Form ────────────────────────────────────────────────────────────────────
  const fundedSources = EVM_CHAINS.filter((c) => balanceOf(c) > 0);

  return (
    <div className="card-glass p-6 sm:p-8 space-y-8">
      {/* From */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
          From
        </p>
        {fundedSources.length === 0 ? (
          <div className="rounded-2xl p-5 text-center text-sm text-white/40 bg-white/3 border border-white/6">
            No USDC found on any network yet. Deposit first.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fundedSources.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setSource(c);
                  if (dest === c) setDest(null);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-3 rounded-xl border transition-all text-left",
                  source === c
                    ? "border-accent/40 bg-accent/10"
                    : "border-white/8 bg-white/3 hover:bg-white/5",
                )}
              >
                <ChainLogo chain={c} size={22} />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {CHAIN_NAMES[c]}
                  </p>
                  <p className="text-[10px] text-white/40 font-mono">
                    ${balanceOf(c).toFixed(2)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <ArrowDown className="w-4 h-4 text-accent" />
        </div>
      </div>

      {/* To */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
          To
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {EVM_CHAINS.filter((c) => c !== source).map((c) => (
            <button
              key={c}
              onClick={() => setDest(c)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-3 rounded-xl border transition-all text-left",
                dest === c
                  ? "border-accent/40 bg-accent/10"
                  : "border-white/8 bg-white/3 hover:bg-white/5",
              )}
            >
              <ChainLogo chain={c} size={22} />
              <p className="text-xs font-bold text-white truncate">
                {CHAIN_NAMES[c]}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
            Amount
          </p>
          {source && (
            <button
              onClick={() => setAmount(sourceBalance.toString())}
              className="text-[10px] font-bold uppercase tracking-widest text-accent/70 hover:text-accent"
            >
              Max ${sourceBalance.toFixed(2)}
            </button>
          )}
        </div>
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white/3 border border-white/8 rounded-2xl px-4 py-4 text-2xl font-bold text-white outline-none focus:border-accent/40 transition-colors"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-white/20 uppercase">
            USDC
          </span>
        </div>
        {amountNum > sourceBalance && source && (
          <p className="text-[11px] text-red-400/80 px-1">
            Exceeds your {CHAIN_NAMES[source]} balance.
          </p>
        )}
      </div>

      <button
        onClick={handleBridge}
        disabled={!canBridge}
        className={cn(
          "w-full h-14 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all",
          canBridge
            ? "btn-accent"
            : "bg-white/5 border border-white/8 text-white/25 cursor-not-allowed",
        )}
      >
        {source && dest
          ? `Bridge to ${CHAIN_NAMES[dest]}`
          : "Select networks"}
      </button>

      <p className="text-[11px] text-white/30 leading-relaxed text-center">
        Funds move between your own wallets via Circle CCTP. Gasless on both sides; a
        small Circle network fee is deducted from the bridged amount.
      </p>
    </div>
  );
}
