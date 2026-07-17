"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
const ALL_CHAIN_NAMES: Record<string, string> = {
  base: "Base",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  avalanche: "Avalanche",
  stellar: "Stellar",
  solana: "Solana",
};
import { type CrossChainSendInfo } from "./useCryptoTransfer";
import { ArrowRight, Layers, Loader2, Route } from "lucide-react";

interface CrossChainSendModalProps {
  info: CrossChainSendInfo | null;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Shown before an external send when the recipient's chain differs from where the
 * user holds funds. Explains that the funds will be bridged automatically and that
 * (because CCTP burns on one chain and mints on another) it takes a few minutes.
 */
export function CrossChainSendModal({
  info,
  loading,
  onConfirm,
  onClose,
}: CrossChainSendModalProps) {
  return (
    <Dialog open={!!info} onOpenChange={(v) => !v && !loading && onClose()}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden border-none rounded-3xl card-glass bg-brand-primary/90 backdrop-blur-3xl">
        <DialogHeader className="p-7 pb-0 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Route className="w-6 h-6 text-accent" />
          </div>
          <DialogTitle className="text-2xl font-display font-bold tracking-tight text-brand-secondary">
            This send crosses networks
          </DialogTitle>
          <DialogDescription className="text-sm text-brand-secondary/50 leading-relaxed">
            {info &&
              (info.consolidate ? (
                <>
                  Your funds are spread across several networks. We&apos;ll gather them
                  onto{" "}
                  <span className="font-bold text-brand-secondary/80">Base</span>, then
                  deliver to the recipient on{" "}
                  <span className="font-bold text-brand-secondary/80">
                    {ALL_CHAIN_NAMES[info.destChain]}
                  </span>
                  .
                </>
              ) : (
                <>
                  Your USDC is on{" "}
                  <span className="font-bold text-brand-secondary/80">
                    {ALL_CHAIN_NAMES[info.sourceChain]}
                  </span>
                  , but you&apos;re sending to an address on{" "}
                  <span className="font-bold text-brand-secondary/80">
                    {ALL_CHAIN_NAMES[info.destChain]}
                  </span>
                  . We&apos;ll bridge it across automatically and deliver it to the
                  recipient.
                </>
              ))}
          </DialogDescription>
        </DialogHeader>

        {info && (
          <div className="px-7 py-6 space-y-5">
            {/* Route visual */}
            <div className="flex items-center justify-center gap-4 py-4 rounded-2xl bg-white/3 border border-white/6">
              <div className="flex flex-col items-center gap-1.5">
                {info.consolidate ? (
                  <>
                    <div className="w-8 h-8 rounded-full bg-white/8 flex items-center justify-center">
                      <Layers className="w-4 h-4 text-brand-secondary/60" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/50">
                      Your networks
                    </span>
                  </>
                ) : (
                  <>
                    <ChainLogo chain={info.sourceChain} size={32} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/50">
                      {ALL_CHAIN_NAMES[info.sourceChain]}
                    </span>
                  </>
                )}
              </div>
              <ArrowRight className="w-5 h-5 text-accent" />
              <div className="flex flex-col items-center gap-1.5">
                <ChainLogo chain={info.destChain} size={32} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/50">
                  {ALL_CHAIN_NAMES[info.destChain]}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-brand-secondary/40 font-medium">Amount</span>
              <span className="font-bold text-brand-secondary">
                ${parseFloat(info.amount).toFixed(2)} USDC
              </span>
            </div>

            <p className="text-[11px] text-brand-secondary/35 leading-relaxed">
              Bridging is gasless but takes a few minutes to settle, and a small Circle
              network fee is deducted from the amount. You can close this app once it
              starts — delivery completes on its own.
            </p>

            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                disabled={loading}
                className="flex-1 h-12 rounded-2xl font-bold text-xs uppercase tracking-widest bg-white/5 border border-white/8 text-brand-secondary/60 hover:bg-white/10 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={loading}
                className="flex-1 h-12 rounded-2xl btn-accent font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Proceed"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
