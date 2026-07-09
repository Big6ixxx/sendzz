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
import {
  CHAIN_EXPLORERS,
  CHAIN_NAMES,
  SMART_BRIDGE_CHAINS,
  type SupportedChain,
} from "@/lib/circle/gateway";
import { recordBridgeTransaction, updateBridgeStatus, getUserActivities } from "@/lib/supabase/transactions";
import { executeSmartBridge } from "@/lib/web3/bridge-actions";
import { prepareSolanaBurnTx } from "@/lib/web3/solana-bridge";
import { cn } from "@/lib/utils";
import { useWallets, usePrivy, type ConnectedWallet } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { useRef, useState, useEffect, useMemo } from "react";
import { toast } from "sonner";

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
};

const CHAIN_EXPLORER_TX: Record<string, (hash: string) => string> = {
  ...Object.fromEntries(
    Object.entries(CHAIN_EXPLORERS).map(([chain, base]) => [
      chain,
      (hash: string) => `${base}/${hash}`,
    ]),
  ),
  solana: (hash: string) => `https://solscan.io/tx/${hash}`,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type MonitoringTx = { hash: string; chain: ChainBalanceChain } | null;

// ─── Component ────────────────────────────────────────────────────────────────

interface SmartBridgeModuleProps {
  smartAddress: string;
  userEmail: string;
  solanaAddress?: string;
}

export function SmartBridgeModule({
  smartAddress,
  userEmail,
  solanaAddress,
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
  } = useCrossChainBalances(smartAddress, solanaAddress);

  // Show all chains with a balance: all 5 EVM source chains + Solana
  const bridges = allBridges?.filter(
    (b) =>
      (SMART_BRIDGE_CHAINS as string[]).includes(b.chain) ||
      b.chain === "solana",
  );

  const [bridgingChain, setBridgingChain] = useState<ChainBalanceChain | null>(null);
  const [monitoringTx, setMonitoringTx] = useState<MonitoringTx>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);

  // ─── Fetch Bridge History for Pending Claims ──────────────────────────────
  const { data: bridgeHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['bridge-history', userEmail],
    queryFn: async () => {
      if (!userEmail) return [];
      const res = await getUserActivities(userEmail);
      return res.bridges || [];
    },
    enabled: !!userEmail,
    refetchInterval: 10000,
  });

  const pendingClaims = useMemo(() => {
    if (!bridgeHistory) return [];
    return bridgeHistory.filter(
      (b) => !b.mint_tx_hash && (b.source_chain === 'stellar' || b.source_chain === 'solana')
    );
  }, [bridgeHistory]);

  // ─── EVM attestation monitor ─────────────────────────────────────────────

  useEffect(() => {
    if (!monitoringTx || isComplete || monitoringTx.chain === "solana") return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
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
    }, 5000);

    return () => clearInterval(interval);
  }, [monitoringTx, isComplete, queryClient]);

  // ─── Solana attestation monitor ──────────────────────────────────────────

  useEffect(() => {
    if (!monitoringTx || isComplete || monitoringTx.chain !== "solana") return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
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
          // Solana has no CCTP auto-relayer on Base — gaslessly submit receiveMessage
          if (!mHash && data.attestation && data.messageBytes && embeddedEvmWallet) {
            const { executeReceiveMessage } = await import("@/lib/web3/bridge-actions");
            mHash = await executeReceiveMessage(
              embeddedEvmWallet,
              data.messageBytes,
              data.attestation,
            );
          }
          setIsComplete(true);
          setMintTxHash(mHash || null);
          clearInterval(interval);
          await updateBridgeStatus(monitoringTx.hash, "complete", mHash);
          queryClient.invalidateQueries({ queryKey: ["history"] });
          queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
          toast.success("Bridge complete! USDC is now on Base.");
        }
      } catch (err) {
        console.error("[SmartBridge] Solana monitoring error:", err);
      }
    }, 5000);

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
      const { txHashPromise } = await executeSmartBridge(
        embeddedEvmWallet,
        chain,
        amount,
        smartAddress,
      );
      const burnTxHash = await txHashPromise;
      await recordBridgeTransaction({
        userEmail,
        sourceChain: chain,
        destChain: "base",
        amountUsdc: parseFloat(amount),
        burnTxHash,
      });
      queryClient.invalidateQueries({ queryKey: ["history"] });
      setMonitoringTx({ hash: burnTxHash, chain });
      setMintTxHash(null);
      toast.success("Bridge submitted! Monitoring progress...");
      refetch();
    } catch (err) {
      console.error("[SmartBridge] EVM bridge failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancelled|rejected/i.test(msg)) {
        toast.error("Bridge failed. Please try again.");
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

      await recordBridgeTransaction({
        userEmail,
        sourceChain: "solana" as never,
        destChain: "base",
        amountUsdc: parseFloat(amount),
        burnTxHash: signature,
      });
      queryClient.invalidateQueries({ queryKey: ["history"] });
      setMonitoringTx({ hash: signature, chain: "solana" });
      setMintTxHash(null);
      toast.success("Solana bridge submitted! Monitoring for Circle attestation...");
      refetch();
    } catch (err) {
      console.error("[SmartBridge] Solana bridge failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancelled|rejected/i.test(msg)) {
        toast.error("Solana bridge failed. Check your balance and try again.");
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
    return void handleEvmBridge(bridge.chain as SupportedChain, bridge.balance);
  };

  const monitoringExplorerUrl =
    monitoringTx && CHAIN_EXPLORER_TX[monitoringTx.chain]
      ? CHAIN_EXPLORER_TX[monitoringTx.chain](monitoringTx.hash)
      : null;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Pending Claims Section */}
      <AnimatePresence>
        {pendingClaims.map((claim) => (
          <PendingClaimCard
            key={claim.id}
            claim={claim}
            embeddedEvmWallet={embeddedEvmWallet}
            onSuccess={() => {
              void refetchHistory();
              void refetch();
            }}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {monitoringTx ? (
          /* ── Monitoring state ────────────────────────────────────── */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-glass p-12 flex flex-col items-center justify-center text-center space-y-6"
          >
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
                      href={`https://basescan.org/tx/${mintTxHash}`}
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
                  onClick={() => {
                    setMonitoringTx(null);
                    setMintTxHash(null);
                    setIsComplete(false);
                    refetch();
                  }}
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
            (Arbitrum, Avalanche, Ethereum, Optimism, Polygon) and your embedded Solana wallet
            for idle USDC. Bridging is gasless on EVM chains. Solana bridges require a small
            SOL fee (~0.001 SOL) paid from your Solana wallet.
          </p>
        </div>
      </div>
    </div>
  );
}

interface PendingClaimCardProps {
  claim: {
    id: string;
    burn_tx_hash: string;
    source_chain: string;
    amount: number;
  };
  embeddedEvmWallet: ConnectedWallet | null | undefined;
  onSuccess: () => void;
}

function PendingClaimCard({ claim, embeddedEvmWallet, onSuccess }: PendingClaimCardProps) {
  const [isClaiming, setIsClaiming] = useState(false);

  const handleClaim = async () => {
    if (!embeddedEvmWallet) {
      toast.error("Embedded EVM wallet not found. Please log in.");
      return;
    }
    setIsClaiming(true);
    try {
      const sourceChain = claim.source_chain.toLowerCase();
      const domain = sourceChain === 'solana' ? 5 : sourceChain === 'stellar' ? 27 : null;
      if (domain === null) {
        toast.error('Unsupported bridge recovery chain.');
        return;
      }

      toast.info('Fetching CCTP attestation from Circle...');
      const res = await fetch(
        `https://iris-api.circle.com/v2/messages/${domain}?transactionHash=${claim.burn_tx_hash}`
      );
      if (!res.ok) {
        throw new Error(`Circle API error: ${res.statusText}`);
      }
      const data = await res.json();
      const message = data.messages?.[0];
      if (!message || message.status !== 'complete') {
        toast.error('Circle attestation is still pending. Try again in 1-2 minutes.');
        return;
      }

      toast.info('Requesting signature to claim USDC on Base...');
      const { executeReceiveMessage } = await import("@/lib/web3/bridge-actions");
      const mintTxHash = await executeReceiveMessage(
        embeddedEvmWallet,
        message.message,
        message.attestation
      );

      toast.success('USDC claimed successfully on Base!');
      
      // Update database status
      await fetch('/api/bridge/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          burnTxHash: claim.burn_tx_hash,
          mintTxHash
        })
      });

      onSuccess();
    } catch (err: unknown) {
      console.error('[Pending Claim] Error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || 'Failed to claim USDC.');
    } finally {
      setIsClaiming(false);
    }
  }

  const chainName = claim.source_chain.charAt(0).toUpperCase() + claim.source_chain.slice(1);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="card-glass p-6 border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-yellow-500/5 shadow-[0_0_20px_rgba(245,158,11,0.1)] relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-amber-500/2 blur-2xl animate-pulse" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <CircleDollarSign className="w-6 h-6" />
          </div>
          <div className="space-y-1 text-left">
            <h4 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              Pending Bridge Claim
            </h4>
            <p className="text-lg font-bold text-white tracking-tight">
              {claim.amount} USDC from {chainName}
            </p>
            <p className="text-xs text-white/40 font-medium">
              Your transfer is ready to be claimed on Base. No gas required.
            </p>
          </div>
        </div>

        <button
          onClick={handleClaim}
          disabled={isClaiming}
          className="h-12 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(245,158,11,0.3)] disabled:opacity-50 flex items-center gap-2 justify-center cursor-pointer"
        >
          {isClaiming ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Claiming...
            </>
          ) : (
            <>
              Claim {claim.amount} USDC
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
