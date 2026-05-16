"use client";

import { useCrossChainBalances } from "@/hooks/useCrossChainBalances";
import { CHAIN_NAMES, type SupportedChain } from "@/lib/circle/gateway";
import { recordBridgeTransaction } from "@/lib/supabase/transactions";
import { executeSmartBridge } from "@/lib/web3/bridge-actions";
import { cn } from "@/lib/utils";
import { useWallets } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CircleDollarSign,
  Loader2,
  Network,
  Repeat,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

interface SmartBridgeModuleProps {
  smartAddress: string;
  userEmail: string;
}

export function SmartBridgeModule({
  smartAddress,
  userEmail,
}: SmartBridgeModuleProps) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const {
    data: bridges,
    isLoading,
    refetch,
  } = useCrossChainBalances(smartAddress);

  const [bridgingChain, setBridgingChain] = useState<SupportedChain | null>(
    null,
  );
  const [monitoringTx, setMonitoringTx] = useState<{ hash: string; chain: SupportedChain } | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  // Poll for completion if we are monitoring a transaction
  useEffect(() => {
    if (!monitoringTx || isComplete) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 120) { // 10 minutes
        clearInterval(interval);
        return;
      }

      try {
        const res = await fetch(`/api/bridge/status?txHash=${monitoringTx.hash}&sourceChain=${monitoringTx.chain}`);
        const data = await res.json();
        if (data.status === 'complete') {
          setIsComplete(true);
          clearInterval(interval);
          queryClient.invalidateQueries({ queryKey: ['history'] });
          toast.success('Bridge complete! Funds are now on Base.');
        }
      } catch (err) {
        console.error('Monitoring error:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [monitoringTx, isComplete, queryClient]);

  const handleBridge = async (chain: SupportedChain, amount: string) => {
    if (!embeddedWallet) return;

    setBridgingChain(chain);
    try {
      const burnTxHash = await executeSmartBridge(
        embeddedWallet,
        chain,
        amount,
        smartAddress,
      );

      // Record the transaction in Supabase
      await recordBridgeTransaction({
        userEmail,
        sourceChain: chain,
        destChain: "base",
        amountUsdc: parseFloat(amount),
        burnTxHash,
      });

      // Force history and balances refresh
      queryClient.invalidateQueries({ queryKey: ['history'] });
      
      setMonitoringTx({ hash: burnTxHash, chain });
      toast.success('Bridge sequence initiated! Monitoring progress...');
      refetch(); // Refresh balances
    } catch (err) {
      console.error("Bridge failed:", err);
    } finally {
      setBridgingChain(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Scanning State */}
      <AnimatePresence mode="wait">
        {isLoading ? (
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
                Checking your smart wallet for stray USDC on Arbitrum, Optimism,
                Polygon, and more...
              </p>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-accent"
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </div>
          </motion.div>
        ) : monitoringTx ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-glass p-12 flex flex-col items-center justify-center text-center space-y-6"
          >
            <div className={cn(
              "w-20 h-20 rounded-3xl flex items-center justify-center transition-all duration-700",
              isComplete ? "bg-accent/10 border-accent/40" : "bg-white/5 border-white/10"
            )}>
              {isComplete ? (
                <CheckCircle2 className="w-10 h-10 text-accent animate-in zoom-in" />
              ) : (
                <Loader2 className="w-10 h-10 text-accent animate-spin" />
              )}
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-display font-bold text-white tracking-tight">
                {isComplete ? 'Bridge Complete' : 'Monitoring Transfer'}
              </h3>
              <p className="text-sm text-white/40 max-w-xs mx-auto">
                {isComplete 
                  ? 'Your funds have successfully arrived on Base. You can check your history for details.'
                  : `Waiting for Circle attestation for your ${CHAIN_NAMES[monitoringTx.chain]} transfer...`}
              </p>
            </div>
            
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <a 
                href={`https://basescan.org/tx/${monitoringTx.hash}`} 
                target="_blank"
                className="btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View Burn Tx
              </a>
              {isComplete && (
                <button 
                  onClick={() => {
                    setMonitoringTx(null);
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
        ) : bridges && bridges.length > 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
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
              {bridges.map((bridge) => (
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
                        <div className="flex items-center gap-2 text-xs text-white/30 font-medium">
                          <span className="capitalize">
                            {CHAIN_NAMES[bridge.chain]}
                          </span>
                          <span className="opacity-30">•</span>
                          <span>Smart Wallet Balance</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleBridge(bridge.chain, bridge.balance)}
                      disabled={!!bridgingChain}
                      className={cn(
                        "h-12 px-6 rounded-xl flex items-center justify-center gap-3 transition-all relative overflow-hidden font-bold text-xs uppercase tracking-widest",
                        bridgingChain === bridge.chain
                          ? "bg-white/5 border border-white/10 text-white/20"
                          : "bg-accent/10 border border-accent/20 text-accent hover:bg-accent hover:text-black",
                      )}
                    >
                      {bridgingChain === bridge.chain ? (
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
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="card-glass p-12 text-center space-y-6"
          >
            <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-white/10" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-display font-bold text-white">
                All Funds are Local
              </h3>
              <p className="text-sm text-white/30 max-w-xs mx-auto leading-relaxed">
                We didn't find any stray USDC on other chains for this smart
                wallet. All your assets are currently on Base.
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/10 transition-all"
            >
              Scan Again
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info Card */}
      <div className="card-glass p-6 border-blue-500/20 bg-blue-500/[0.02] flex gap-4">
        <div className="p-2 h-fit rounded-lg bg-blue-500/10">
          <AlertCircle className="w-4 h-4 text-blue-400" />
        </div>
        <div className="space-y-1">
          <h5 className="text-xs font-bold text-blue-400 uppercase tracking-widest">
            About Smart Bridge
          </h5>
          <p className="text-[11px] text-white/40 leading-relaxed font-medium">
            Smart Bridge detects funds held by your embedded smart wallet on
            other networks. Because your smart address is consistent across
            chains, we can safely bridge these funds to Base. No gas required on
            Base.
          </p>
        </div>
      </div>
    </div>
  );
}
