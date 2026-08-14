"use client";

/**
 * SmartBridgeModule
 *
 * Scans the user's Circle smart wallet (EVM) and their Privy embedded Solana wallet
 * for any USDC balances, and allows one-click bridging to Base.
 *
 * EVM chains (all source chains): arbitrum, avalanche, ethereum, optimism, polygon
 *   — Bridges via Circle smart account (AA, gasless via Privy)
 *
 * Solana:
 *   — Bridges via Privy embedded Solana wallet (walletClientType === 'privy')
 *   — No external wallet (Phantom/Backpack) required
 *   — Uses useSignTransaction + self-broadcast via Connection
 */

import { useCrossChainBalances, type ChainBalance, type ChainBalanceChain } from "@/hooks/useCrossChainBalances";
import { quoteFee } from "@/lib/actions/fees";
import { MONITOR_MAX_ATTEMPTS, MONITOR_POLL_MS } from "@/lib/web3/bridge-timing";
import {
  CHAIN_NAMES,
  SMART_BRIDGE_CHAINS,
  type SupportedChain,
} from "@/lib/circle/gateway";
import { isPlaceholderHash } from "@/lib/explorers";
import { updateBridgeStatus } from "@/lib/supabase/transactions";
import { executeSmartBridge } from "@/lib/web3/bridge-actions";
import { prepareSolanaBurnTx } from "@/lib/web3/solana-bridge";
import { cn } from "@/lib/utils";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { useQueryClient } from "@tanstack/react-query";
import { Connection } from "@solana/web3.js";
import { Buffer } from "buffer";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CircleDollarSign,
  Loader2,
  Network,
  Zap,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  X,
} from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { parseAppError, isUserCancelled } from "@/lib/errors/appErrors";
import { explorerTxUrl } from "@/lib/explorers";

if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
  if (!window.Buffer.prototype.writeBigUInt64LE) {
    window.Buffer = Buffer;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  ...CHAIN_NAMES,
  solana: "Solana",
  stellar: "Stellar",
};


// ─── Types ────────────────────────────────────────────────────────────────────

type MonitoringTx = { hash: string; chain: ChainBalanceChain } | null;

// ─── Component ────────────────────────────────────────────────────────────────

interface SmartBridgeModuleProps {
  smartAddress: string;
  userEmail: string;
  solanaAddress?: string;
  /** Stellar wallet from Privy TEE — walletId + address */
  stellarWallet?: { walletId: string; address: string } | null;
}

export function SmartBridgeModule({
  smartAddress,
  userEmail,
  solanaAddress,
  stellarWallet,
}: SmartBridgeModuleProps) {
  const { wallets } = useWallets();
  const { user } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const queryClient = useQueryClient();

  const solConn = useRef(new Connection(SOLANA_RPC, "confirmed"));

  // Embedded EVM wallet (Circle AA — used for gasless EVM bridges + Base receiveMessage)
  const embeddedEvmWallet = wallets.find((w) => w.walletClientType === "privy");
  // Embedded Privy Solana wallet — auto-created on login, no external wallet needed
  const privySolAccount = user?.linkedAccounts.find(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'solana'
  );
  const privySolanaAddress = privySolAccount && 'address' in privySolAccount ? (privySolAccount as { address: string }).address : undefined;
  const embeddedSolWallet = solanaWallets.find((w) => w.address === privySolanaAddress) ?? null;

  const {
    data: allBridges,
    isLoading,
    isFetching,
    refetch,
  } = useCrossChainBalances(smartAddress, solanaAddress, stellarWallet?.address);

  // Show all chains with a balance: all 5 EVM source chains + Solana + Stellar
  const bridges = allBridges?.filter(
    (b) =>
      (SMART_BRIDGE_CHAINS as string[]).includes(b.chain) ||
      b.chain === "solana" ||
      b.chain === "stellar",
  );

  const [bridgingChain, setBridgingChain] = useState<ChainBalanceChain | null>(null);
  const [monitoringTx, setMonitoringTx] = useState<MonitoringTx>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);

  const dismissComplete = () => {
    setMonitoringTx(null);
    setMintTxHash(null);
    setIsComplete(false);
    refetch();
  };

  // Burns awaiting a claim are surfaced by <PendingBridgeClaims /> on the bridge page —
  // it covers every destination chain, not just consolidation back to Base.

  // ─── EVM attestation monitor ─────────────────────────────────────────────

  useEffect(() => {
    if (!monitoringTx || isComplete || monitoringTx.chain === "solana" || monitoringTx.chain === "stellar") return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MONITOR_MAX_ATTEMPTS) {
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch(
          `/api/bridge/status?txHash=${monitoringTx.hash}&sourceChain=${monitoringTx.chain}`,
        );
        const data = await res.json();
        if (data.status === "complete") {
          setIsComplete(true);
          setMintTxHash(data.mintTxHash || null);
          clearInterval(interval);
          await fetch("/api/bridge/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              burnTxHash: monitoringTx.hash,
              mintTxHash: data.mintTxHash,
            }),
          });
          queryClient.invalidateQueries({ queryKey: ["history"] });
          queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
          toast.success("Bridge complete! Funds are now on Base.");
        }
      } catch (err) {
        console.error("[SmartBridge] EVM monitoring error:", err);
      }
    }, MONITOR_POLL_MS);

    return () => clearInterval(interval);
  }, [monitoringTx, isComplete, queryClient]);

  // ─── Solana attestation monitor ──────────────────────────────────────────

  useEffect(() => {
    if (!monitoringTx || isComplete || monitoringTx.chain !== "solana") return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MONITOR_MAX_ATTEMPTS) {
        clearInterval(interval);
        return;
      }
      try {
        const res = await fetch(
          `/api/bridge/status?txHash=${monitoringTx.hash}&sourceChain=solana`,
        );
        const data = await res.json();
        if (data.status === "complete") {
          let mHash = data.mintTxHash ?? "";
          const activeEvmWallet = embeddedEvmWallet ?? wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];

          if ((!mHash || mHash === 'N/A' || isPlaceholderHash(mHash)) && data.attestation && data.messageBytes && activeEvmWallet) {
            const { executeReceiveMessage } = await import("@/lib/web3/bridge-actions");
            const resHash = await executeReceiveMessage(
              activeEvmWallet,
              data.messageBytes,
              data.attestation,
            ).catch(() => null);
            if (resHash && resHash !== 'N/A' && !isPlaceholderHash(resHash)) {
              mHash = resHash;
            }
          }

          if (mHash && mHash !== 'N/A' && !isPlaceholderHash(mHash)) {
            console.log(`[SmartBridgeModule] 🎉 Mint transaction hash resolved (${monitoringTx.hash}):`, mHash);
            setIsComplete(true);
            setMintTxHash(mHash);
            clearInterval(interval);
            await updateBridgeStatus(monitoringTx.hash, "complete", mHash);
            queryClient.invalidateQueries({ queryKey: ["history"] });
            queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
            toast.success("Bridge complete! USDC is now on Base.");
          }
        }
      } catch (err) {
        console.error("[SmartBridge] Solana monitoring error:", err);
      }
    }, MONITOR_POLL_MS);

    return () => clearInterval(interval);
  }, [monitoringTx, isComplete, queryClient, embeddedEvmWallet]);

  // ─── Stellar attestation monitor (Privy TEE wallet bridge) ─────────────

  useEffect(() => {
    if (!monitoringTx || isComplete || monitoringTx.chain !== "stellar") return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MONITOR_MAX_ATTEMPTS) { clearInterval(interval); return; }
      try {
        const res = await fetch(
          `/api/bridge/status?txHash=${monitoringTx.hash}&sourceChain=stellar`,
        );
        const data = await res.json() as { status: string; attestation?: string; messageBytes?: string; mintTxHash?: string };
        if (data.status === "complete") {
          let mHash = data.mintTxHash ?? "";
          const activeEvmWallet = embeddedEvmWallet ?? wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];

          if ((!mHash || mHash === 'N/A' || isPlaceholderHash(mHash)) && data.attestation && data.messageBytes && activeEvmWallet) {
            const { executeReceiveMessage } = await import("@/lib/web3/bridge-actions");
            const resHash = await executeReceiveMessage(
              activeEvmWallet,
              data.messageBytes,
              data.attestation,
            ).catch((err) => {
              console.error("[SmartBridge] Stellar executeReceiveMessage error:", err);
              return null;
            });
            if (resHash && resHash !== 'N/A' && !isPlaceholderHash(resHash)) {
              mHash = resHash;
            }
          }

          if (mHash && mHash !== 'N/A' && !isPlaceholderHash(mHash)) {
            setIsComplete(true);
            setMintTxHash(mHash);
            clearInterval(interval);
            await fetch("/api/bridge/complete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ burnTxHash: monitoringTx.hash, mintTxHash: mHash }),
            });
            queryClient.invalidateQueries({ queryKey: ["history"] });
            queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
            toast.success("Stellar bridge complete! USDC is now on Base.");
          }
        }
      } catch (err) {
        console.error("[SmartBridge] Stellar monitoring error:", err);
      }
    }, MONITOR_POLL_MS);

    return () => clearInterval(interval);
  }, [monitoringTx, isComplete, queryClient, embeddedEvmWallet]);

  // ─── EVM bridge handler ──────────────────────────────────────────────────

  const handleEvmBridge = async (chain: SupportedChain, amount: string) => {
    if (!embeddedEvmWallet) {
      toast.error("Embedded EVM wallet not found.");
      return;
    }
    setBridgingChain(chain);
    try {
      // Consolidating is still a bridge the user asked for, so it's charged — unlike the
      // consolidation we trigger ourselves to fund a withdrawal, which passes no fee at all.
      // Resolved before the burn: a burn can't be undone if the chain has no treasury.
      let platformFee: { usdc: string; treasury: string } | undefined;
      const quote = await quoteFee("bridge", chain, parseFloat(amount));
      if (quote.fee > 0) {
        if (!quote.treasury) {
          throw new Error(
            `Bridging from ${chain} is unavailable right now. Please try another network.`,
          );
        }
        platformFee = { usdc: quote.fee.toFixed(6), treasury: quote.treasury };
      }

      const { txHashPromise } = await executeSmartBridge(
        embeddedEvmWallet,
        chain,
        amount,
        smartAddress,
        "base",
        platformFee,
      );
      const burnTxHash = await txHashPromise;
      await fetch("/api/bridge/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          sourceChain: chain,
          destChain: "base",
          amountUsdc: parseFloat(amount),
          burnTxHash,
        }),
      }).catch(console.error);
      queryClient.invalidateQueries({ queryKey: ["history"] });
      setMonitoringTx({ hash: burnTxHash, chain });
      setMintTxHash(null);
      toast.success("Bridge submitted! Monitoring progress...");
      refetch();
    } catch (err) {
      if (!isUserCancelled(err)) {
        toast.error(parseAppError(err));
      }
    } finally {
      setBridgingChain(null);
    }
  };

  // ─── Solana bridge handler ───────────────────────────────────────────────

  const handleSolanaBridge = async (amount: string) => {
    if (!embeddedSolWallet) {
      toast.error("Solana wallet not ready. Please wait a moment.");
      return;
    }
    setBridgingChain("solana");
    try {
      // Build + fee-sponsor the Solana burn (shared with the routing consolidation path).
      const { sponsoredTx } = await prepareSolanaBurnTx({
        connection: solConn.current,
        walletAddress: embeddedSolWallet.address,
        amount,
        recipientEvm: smartAddress, // user's EVM smart address on Base
      });

      // Privy signs the already-fee-sponsored transaction with the embedded Solana wallet
      const { signedTransaction: signedBytes } = await signTransaction({
        transaction: sponsoredTx.serialize({ requireAllSignatures: false }),
        wallet: embeddedSolWallet,
      });

      // Broadcast the fully-signed transaction ourselves
      const signature = await solConn.current.sendRawTransaction(signedBytes, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const latestBlockhash = await solConn.current.getLatestBlockhash();
      await solConn.current.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, "confirmed");

      await fetch("/api/bridge/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          sourceChain: "solana",
          destChain: "base",
          amountUsdc: parseFloat(amount),
          burnTxHash: signature,
        }),
      }).catch(console.error);
      queryClient.invalidateQueries({ queryKey: ["history"] });
      setMonitoringTx({ hash: signature, chain: "solana" });
      setMintTxHash(null);
      toast.success("Solana bridge submitted! Monitoring cross-chain attestation...");
      refetch();
    } catch (err) {
      if (!isUserCancelled(err)) {
        toast.error(parseAppError(err));
      }
    } finally {
      setBridgingChain(null);
    }
  };

  // ─── Stellar bridge handler (Privy TEE wallet) ──────────────────────────

  const handleStellarPrivyBridge = async (amount: string) => {
    if (!stellarWallet?.walletId || !stellarWallet?.address) {
      toast.error("Stellar wallet not found. Open the Stellar page first to set it up.");
      return;
    }
    setBridgingChain("stellar" as ChainBalanceChain);
    try {
      console.log(`[SmartBridge] Stellar bridge: ${amount} USDC → Base (${smartAddress})`);
      const res = await fetch("/api/stellar/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletId: stellarWallet.walletId,
          senderAddress: stellarWallet.address,
          recipientAddress: smartAddress,
          amount,
          userEmail,
        }),
      });
      const data = await res.json() as { burnTxHash?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Stellar bridge failed");

      const burnTxHash = data.burnTxHash!;
      await fetch("/api/bridge/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          sourceChain: "stellar",
          destChain: "base",
          amountUsdc: parseFloat(amount),
          burnTxHash,
        }),
      }).catch(console.error);
      setMonitoringTx({ hash: burnTxHash, chain: "stellar" as ChainBalanceChain });
      setMintTxHash(null);
      toast.success("Stellar bridge submitted! Monitoring cross-chain attestation...");
      refetch();
    } catch (err) {
      if (!isUserCancelled(err)) {
        toast.error(parseAppError(err));
      }
    } finally {
      setBridgingChain(null);
    }
  };

  // ─── Unified bridge dispatcher ───────────────────────────────────────────

  const handleBridge = (bridge: ChainBalance) => {
    if (bridge.chain === "solana") {
      return void handleSolanaBridge(bridge.balance);
    }
    if (bridge.chain === "stellar") {
      return void handleStellarPrivyBridge(bridge.balance);
    }
    return void handleEvmBridge(bridge.chain as SupportedChain, bridge.balance);
  };

  const monitoringExplorerUrl = monitoringTx
    ? explorerTxUrl(monitoringTx.chain, monitoringTx.hash)
    : null;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      <AnimatePresence mode="wait">
        {monitoringTx ? (
          /* ── Monitoring state ────────────────────────────────────── */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-glass p-12 flex flex-col items-center justify-center text-center space-y-6 relative"
          >
            {/* Once it's done the card is just a receipt — let it be closed outright. */}
            {isComplete && (
              <button
                onClick={dismissComplete}
                aria-label="Dismiss"
                className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <div
              className={cn(
                "w-20 h-20 rounded-3xl flex items-center justify-center transition-all duration-700",
                isComplete
                  ? "bg-accent/10 border-accent/40"
                  : "bg-white/5 border-white/10",
              )}
            >
              {isComplete ? (
                <CheckCircle2 className="w-10 h-10 text-accent animate-in zoom-in" />
              ) : (
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-display font-bold text-white tracking-tight">
                {isComplete ? "Bridge Complete" : "Monitoring Transfer"}
              </h3>
              <p className="text-sm text-white/40 max-w-xs mx-auto">
                {isComplete
                  ? "Your funds have successfully arrived on Base."
                  : `Waiting for Circle attestation for your ${CHAIN_DISPLAY_NAMES[monitoringTx.chain] ?? monitoringTx.chain} transfer...`}
              </p>
            </div>

            <div className="flex flex-col gap-3 w-full max-w-xs">
              {isComplete ? (
                <div className="grid grid-cols-2 gap-3 w-full">
                  {monitoringExplorerUrl && (
                    <a
                      href={monitoringExplorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Burn Tx
                    </a>
                  )}
                  {mintTxHash ? (
                    <a
                      href={explorerTxUrl("base", mintTxHash) ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Mint Tx
                    </a>
                  ) : (
                    <div className="h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest bg-white/2 text-white/20 border border-white/5 cursor-not-allowed select-none">
                      Mint Pending
                    </div>
                  )}
                </div>
              ) : (
                monitoringExplorerUrl && (
                  <a
                    href={monitoringExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View on {CHAIN_DISPLAY_NAMES[monitoringTx.chain] ?? monitoringTx.chain}
                  </a>
                )
              )}
              {isComplete && (
                <button
                  onClick={dismissComplete}
                  className="btn-accent h-11 rounded-xl text-[10px] font-bold uppercase tracking-widest"
                >
                  Bridge More
                </button>
              )}
            </div>
          </motion.div>
        ) : isLoading ? (
          /* ── Scanning ────────────────────────────────────────────── */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="card-glass p-12 flex flex-col items-center justify-center text-center space-y-6"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-accent/20 rounded-full blur-2xl animate-pulse scale-150" />
              <div className="relative w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                <Network className="w-10 h-10 text-accent animate-pulse" />
                <motion.div
                  className="absolute inset-0 border-2 border-transparent border-t-accent rounded-3xl"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-display font-bold text-white tracking-tight">
                Scanning Multi-Chain
              </h3>
              <p className="text-sm text-white/40 max-w-xs mx-auto">
                Checking Arbitrum, Avalanche, Ethereum, Optimism, Polygon
                {solanaAddress ? ", and Solana" : ""}…
              </p>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-accent"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
          </motion.div>
        ) : bridges && bridges.length > 0 ? (
          /* ── Balances found ──────────────────────────────────────── */
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/30">
                  Balances Found
                </h3>
              </div>
              <button
                onClick={() => refetch()}
                className="text-[10px] font-bold uppercase tracking-widest text-accent/60 hover:text-accent transition-colors flex items-center gap-2"
              >
                <Zap className="w-3 h-3" /> Rescan
              </button>
            </div>

            <div className="grid gap-4">
              {bridges.map((bridge) => {
                const chainName = CHAIN_DISPLAY_NAMES[bridge.chain] ?? bridge.chain;
                const isBridging = bridgingChain === bridge.chain;

                return (
                  <motion.div
                    key={bridge.chain}
                    layout
                    className="card-glass p-6 group hover:border-accent/30 transition-all duration-300"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                      <div className="flex items-center gap-5">
                        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                          <CircleDollarSign className="w-6 h-6 text-accent" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-white tracking-tight">
                            {bridge.balance} USDC
                          </h4>
                          <p className="text-xs text-white/30 font-medium capitalize">
                            {chainName}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleBridge(bridge)}
                        disabled={!!bridgingChain}
                        className={cn(
                          "h-12 px-6 rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-xs uppercase tracking-widest",
                          isBridging
                            ? "bg-white/5 border border-white/10 text-white/20"
                            : "bg-accent/10 border border-accent/20 text-accent hover:bg-accent hover:text-black",
                        )}
                      >
                        {isBridging ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Processing
                          </>
                        ) : (
                          <>
                            Bridge to Base
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ) : (
          /* ── All clear ───────────────────────────────────────────── */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="card-glass p-12 text-center space-y-6"
          >
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-white/10" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-display font-bold text-white">All Funds are Local</h3>
              <p className="text-sm text-white/30 max-w-xs mx-auto leading-relaxed">
                No stray USDC found on other chains. All your assets are currently on Base.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/10 transition-all flex items-center gap-2 mx-auto disabled:opacity-50"
            >
              {isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
              {isFetching ? "Scanning..." : "Scan Again"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info card */}
      <div className="card-glass p-6 border-blue-500/20 bg-blue-500/2 flex gap-4">
        <div className="p-2 h-fit rounded-lg bg-blue-500/10">
          <AlertCircle className="w-4 h-4 text-blue-400" />
        </div>
        <div className="space-y-1">
          <h5 className="text-xs font-bold text-blue-400 uppercase tracking-widest">
            About Smart Bridge
          </h5>
          <p className="text-[11px] text-white/40 leading-relaxed font-medium">
            Smart Bridge scans your embedded smart wallet across all supported EVM chains
            (Arbitrum, Avalanche, Ethereum, Optimism, Polygon), your embedded Solana wallet,
            and your Stellar wallet for idle USDC. Bridging is gasless on EVM chains and Stellar
            (platform sponsors all fees). Solana bridges require a small SOL fee (~0.001 SOL).
          </p>
        </div>
      </div>
    </div>
  );
}
