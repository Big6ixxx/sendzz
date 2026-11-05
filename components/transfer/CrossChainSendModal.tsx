"use client";

import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
const ALL_CHAIN_NAMES: Record<string, string> = {
  base: "Base",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  avalanche: "Avalanche",
  arc: "Arc",
  stellar: "Stellar",
  solana: "Solana",
};
import { type CrossChainSendInfo } from "./useCryptoTransfer";
import { ArrowRight, Layers } from "lucide-react";
import { FlowConfirm } from "@/components/flow/ui";

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
  const name = (c: string) => ALL_CHAIN_NAMES[c] ?? c;
  const end = (logo: React.ReactNode, label: string) => (
    <span className="flex min-w-0 flex-col items-center gap-2">
      {logo}
      <span className="truncate text-[13px] font-semibold">{label}</span>
    </span>
  );
  return (
    <FlowConfirm
      open={!!info}
      onClose={onClose}
      eyebrow="Before you send"
      title="This send"
      italic="crosses networks."
      confirmLabel="Send it"
      onConfirm={onConfirm}
      loading={loading}
      tone="accent"
    >
      {info && (
        <>
          <p>
            {info.consolidate
              ? `Your money is spread across a few networks. We'll gather it on Base, then deliver it on ${name(info.destChain)}.`
              : `Your USDC is on ${name(info.sourceChain)}, and this address is on ${name(info.destChain)}. We'll move it across and deliver it for you.`}
          </p>
          <div className="lp-card mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[22px] px-4 py-5">
            {info.consolidate
              ? end(
                  <span className="grid size-8 place-items-center rounded-full bg-[var(--lp-cream)]">
                    <Layers className="size-4" />
                  </span>,
                  'Your networks',
                )
              : end(<ChainLogo chain={info.sourceChain} size={32} />, name(info.sourceChain))}
            <ArrowRight className="size-5 text-[var(--lp-muted)]" />
            {end(<ChainLogo chain={info.destChain} size={32} />, name(info.destChain))}
          </div>
          <div className="mt-4 flex items-baseline justify-between gap-3">
            <span className="text-[14px] text-[var(--lp-muted)]">Amount</span>
            <span className="text-[15px] font-semibold tabular-nums text-[var(--lp-ink)]">
              ${parseFloat(info.amount).toFixed(2)} USDC
            </span>
          </div>
          <p className="mt-2 text-[13px] text-[var(--lp-muted)]">We cover the network fee. It takes a few minutes to arrive.</p>
        </>
      )}
    </FlowConfirm>
  );
}
